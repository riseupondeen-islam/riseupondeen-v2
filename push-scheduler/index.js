const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { getAuth } = require('firebase-admin/auth');
const { processDeenFriendsEvents } = require('./deenFriends');
const { runMaintenance } = require('./maintenance');
const { processAdminJobs } = require('./adminJobs');
const { runChallengeSchedule } = require('./challengeScheduler');
const { processRiseBroadcasts } = require('./riseBroadcasts');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON secret is missing or invalid.');
}
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const messaging = getMessaging();

const PUSH_COLLECTION = 'push_subscriptions';
const JOB_COLLECTION = 'push_jobs';
const DELIVERY_COLLECTION = 'push_prayer_deliveries';
const PRAYER_KEYS = ['fajr','dhuhr','asr','maghrib','isha'];
const PRAYER_LABELS = {fajr:'Fajr',dhuhr:'Dhuhr',asr:'Asr',maghrib:'Maghrib',isha:'Isha'};
const ALADHAN_BASE = 'https://api.aladhan.com/v1/timings';
/* Free-tier Firestore budget (the cause of "8 RESOURCE_EXHAUSTED: Quota exceeded"): the scheduler runs
   ~288 times a day, so it must not read every subscription on every run. Each prayer subscriber now
   carries the time of its next prayer (prayerNextCheckMs, written only by this scheduler), and a run
   reads only subscribers that are due plus subscriptions the visitor changed since the last run. */
const PRAYER_STATE_DOC = 'push_scheduler_state/prayer';
const PRAYER_NEXT_FIELD = 'prayerNextCheckMs';
const PRAYER_RETRY_MS = 30 * 60 * 1000;
const PRAYER_SYNC_OVERLAP_MS = 2 * 60 * 1000;
const PRAYER_PAGE = 500;
/* A queued job that cannot be delivered is retried for about an hour, then marked failed. Before, it
   stayed queued forever and re-read every subscription on every run. */
const MAX_JOB_ATTEMPTS = 12;

function cleanTime(value){
  const m=String(value||'').match(/^(\d{1,2}):(\d{2})$/); if(!m)return '';
  const h=Number(m[1]),min=Number(m[2]); if(h>23||min>59)return '';
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}
function zoneParts(date,timeZone){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return Object.fromEntries(parts.map(p=>[p.type,p.value]));
}
function localNow(timeZone){
  const p=zoneParts(new Date(),timeZone||'UTC');
  return {date:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour),minute:Number(p.minute),timeZone:timeZone||'UTC'};
}
function apiDate(date){const m=String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:'';}
function validPrayers(prayers){return PRAYER_KEYS.every(k=>!!cleanTime(prayers?.timings?.[k]));}
function minuteDistance(h,m,t){const [th,tm]=t.split(':').map(Number);return h*60+m-(th*60+tm);}
/** UTC milliseconds of a wall-clock date + "HH:MM" in an IANA time zone. */
function zonedMs(date,time,timeZone){
  const [y,mo,d]=date.split('-').map(Number),[h,mi]=time.split(':').map(Number),want=Date.UTC(y,mo-1,d,h,mi);
  let guess=want;
  for(let i=0;i<2;i++){const p=zoneParts(new Date(guess),timeZone);guess+=want-Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute));}
  return guess;
}
function nextDay(date){const [y,m,d]=date.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10);}
/** When this subscriber next needs attention: its next prayer today, else just after local midnight. */
function nextPrayerCheckMs(prayers,today){
  const upcoming=PRAYER_KEYS.map(k=>cleanTime(prayers.timings[k])).filter(t=>t&&minuteDistance(today.hour,today.minute,t)<0).sort();
  return upcoming.length?zonedMs(today.date,upcoming[0],today.timeZone):zonedMs(nextDay(today.date),'00:01',today.timeZone);
}

async function fetchPrayerTimes({date,lat,lng,method,school}){
  const latitude=Number(lat),longitude=Number(lng);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return null;
  const params=new URLSearchParams({latitude:String(latitude),longitude:String(longitude),method:String(Number.isFinite(Number(method))?Number(method):4),school:String(Number(school)===1?1:0)});
  const response=await fetch(`${ALADHAN_BASE}/${apiDate(date)}?${params.toString()}`,{headers:{accept:'application/json'}});
  if(!response.ok)throw new Error(`AlAdhan HTTP ${response.status}`);
  const json=await response.json(),data=json?.data;
  if(!data?.timings)throw new Error('AlAdhan returned no timings');
  const timings={};
  for(const key of PRAYER_KEYS){const label=key[0].toUpperCase()+key.slice(1);timings[key]=cleanTime(data.timings[label]);}
  if(!validPrayers({timings}))return null;
  return {date,timeZone:String(data.meta?.timezone||''),timings,method:Number(data.meta?.method?.id??method??4),school:Number(school)===1?1:0,lat:Math.round(latitude*1000)/1000,lng:Math.round(longitude*1000)/1000};
}

async function ensureTodaySchedule(ref,record,today,cache){
  const schedule=record.schedule||{},existing=schedule.prayers;
  if(existing?.date===today.date&&validPrayers(existing))return existing;
  const lat=Number(schedule.lat??existing?.lat),lng=Number(schedule.lng??existing?.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;
  const method=Number(schedule.method??existing?.method??4),school=Number(schedule.school??existing?.school??0)===1?1:0;
  const key=`${today.date}|${lat.toFixed(3)}|${lng.toFixed(3)}|${method}|${school}`;
  let prayers=cache.get(key);
  if(!prayers){prayers=await fetchPrayerTimes({date:today.date,lat,lng,method,school});if(prayers)cache.set(key,prayers);}
  if(!prayers)return null;
  await ref.set({schedule:{...schedule,timeZone:today.timeZone,lat,lng,method,school,prayers},updatedAt:FieldValue.serverTimestamp()},{merge:true});
  return prayers;
}

async function claimDelivery(visitorId,date,key){
  const id=`${visitorId}_${date}_${key}`.replace(/[^a-zA-Z0-9_-]/g,'_');
  const ref=db.collection(DELIVERY_COLLECTION).doc(id);
  return db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.exists)return false;tx.create(ref,{visitorId,prayerDate:date,prayerKey:key,createdAt:FieldValue.serverTimestamp()});return true;});
}
function invalidToken(code){return /registration-token-not-registered|invalid-registration-token|messaging\/invalid-registration-token/.test(String(code||''));}
async function disableToken(docRef){await docRef.set({active:false,fcmToken:null,enabledCategories:[],updatedAt:FieldValue.serverTimestamp()},{merge:true});}

async function sendPrayer(doc,record,key,date){
  const token=String(record.fcmToken||'').trim();if(!token)return false;
  const claimed=await claimDelivery(String(record.visitorId||doc.id),date,key);if(!claimed)return false;
  const label=PRAYER_LABELS[key],dedupeId=`prayer:${date}:${key}`;
  try{
    await messaging.send({token,data:{title:`${label} Prayer`,message:`It is time for ${label}.`,body:`It is time for ${label}.`,category:'prayer',prayerName:key,prayerDate:date,dedupeId,route:'#prayer'},webpush:{headers:{TTL:'900',Urgency:'high'}}});
    return true;
  }catch(error){if(invalidToken(error?.code))await disableToken(doc.ref);else await db.collection(DELIVERY_COLLECTION).doc(`${String(record.visitorId||doc.id)}_${date}_${key}`.replace(/[^a-zA-Z0-9_-]/g,'_')).delete().catch(()=>{});throw error;}
}

let activeSubscriptionDocs=null;
/** All active subscriptions, read at most once per run and shared by every broadcast job. */
async function activeSubscriptions(){
  if(!activeSubscriptionDocs)activeSubscriptionDocs=(await db.collection(PUSH_COLLECTION).where('active','==',true).get()).docs;
  return activeSubscriptionDocs;
}
/** A single-recipient job reads only that visitor's subscription (the document id is the visitor id). */
async function jobRecipients(job){
  if(job.audience!=='single')return activeSubscriptions();
  const id=String(job.targetVisitorId||'').trim();
  if(!id||id.includes('/'))return [];
  const snap=await db.collection(PUSH_COLLECTION).doc(id).get();
  return snap.exists&&snap.get('active')===true?[snap]:[];
}
async function sendGenericJob(jobRef,job){
  const now=Date.now();
  if(job.status!=='queued')return {skipped:true};
  if(job.scheduledAt){
    const t=Date.parse(job.scheduledAt);
    if(Number.isFinite(t)&&t>now)return {skipped:true};
  }
  const category=String(job.category||'announcement');
  const title=String(job.title||'Rise Upon Deen').slice(0,120);
  const message=String(job.message||'').slice(0,280);
  const route=String(job.route||'#home').startsWith('#')?String(job.route||'#home'):'#home';
  const forceTest=job.forceTest===true;
  const recipients=await jobRecipients(job);
  let sent=0,eligible=0;
  for(const doc of recipients){
    const r=doc.data()||{};
    if(!r.fcmToken)continue;
    if(job.audience==='single'&&String(r.visitorId||doc.id)!==String(job.targetVisitorId||''))continue;
    const cats=r.schedule?.categories||{};
    if(!forceTest&&cats[category]===false)continue;
    const installed=['android-pwa','ios-home-screen','installed-pwa'].includes(String(r.platform||r.schedule?.platform||''));
    if(job.audience==='app'&&!installed)continue;
    if(job.audience==='browser'&&installed)continue;
    eligible++;
    try{
      await messaging.send({
        token:r.fcmToken,
        data:{title,message,body:message,category,route,dedupeId:String(job.dedupeId||jobRef.id),adminTest:forceTest?'1':'0'},
        webpush:{headers:{TTL:'900',Urgency:forceTest?'high':'normal'}}
      });
      sent++;
    }catch(error){
      if(invalidToken(error?.code))await disableToken(doc.ref);
      else console.warn(`Generic push failed for ${doc.id}`,error?.message||error);
    }
  }
  if(sent>0){
    await jobRef.set({status:'sent',sent,eligible,processedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),lastError:null},{merge:true});
    return {sent,eligible};
  }
  const attempts=(Number(job.attempts)||0)+1,giveUp=attempts>=MAX_JOB_ATTEMPTS;
  const reason=eligible===0?'No active matching FCM subscription was available':'FCM delivery failed for all matching subscriptions';
  await jobRef.set({
    status:giveUp?'failed':'queued',
    eligible,
    attempts,
    attemptedAt:FieldValue.serverTimestamp(),
    updatedAt:FieldValue.serverTimestamp(),
    lastError:giveUp?`${reason} after ${attempts} attempts; not retried.`:`${reason}; retrying on the next run.`
  },{merge:true});
  return {sent:0,eligible,retry:!giveUp};
}
async function processJobs(){
  const snap=await db.collection(JOB_COLLECTION).where('status','==','queued').limit(100).get();
  let sent=0,processed=0;
  for(const doc of snap.docs){try{const r=await sendGenericJob(doc.ref,doc.data()||{});if(r.sent)sent+=r.sent;if(r.skipped)continue;processed++;}catch(e){await doc.ref.set({lastError:String(e?.message||e),attemptedAt:FieldValue.serverTimestamp()},{merge:true});}}
  return {jobs:processed,sent};
}

/** Sends any prayer due now to one subscriber and records when it next needs attention. */
async function processPrayerSubscriber(doc,cache){
  const record=doc.data()||{},schedule=record.schedule||{},categories=schedule.categories||{};
  const stored=record[PRAYER_NEXT_FIELD];
  const stopChecking=async()=>{if(stored!==undefined)await doc.ref.update({[PRAYER_NEXT_FIELD]:FieldValue.delete()});};
  if(record.active!==true||categories.prayer!==true||!record.fcmToken||!schedule.timeZone){
    // Not a prayer subscriber (any more): stop checking until the visitor changes their settings.
    await stopChecking();
    return {subscriber:false,sent:0};
  }
  const lat=schedule.lat??schedule.prayers?.lat,lng=schedule.lng??schedule.prayers?.lng;
  const hasPlace=lat!=null&&lng!=null&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lng));
  let sent=0,next=Date.now()+PRAYER_RETRY_MS;
  try{
    const today=localNow(String(schedule.timeZone));
    const prayers=await ensureTodaySchedule(doc.ref,record,today,cache);
    if(prayers&&prayers.date===today.date){
      for(const key of PRAYER_KEYS){const t=cleanTime(prayers.timings[key]);if(!t)continue;const delta=minuteDistance(today.hour,today.minute,t);
        // GitHub's free scheduler has a minimum 5-minute cadence and is sometimes late; a 30-minute
        // catch-up window prevents a delayed run from losing a prayer alert.
        if(delta<0||delta>30)continue;
        try{if(await sendPrayer(doc,record,key,today.date))sent++;}catch(e){console.warn(`Prayer send failed ${doc.id}/${key}`,e?.message||e);}
      }
      next=nextPrayerCheckMs(prayers,today);
    }else if(!hasPlace){
      // No location to calculate tomorrow's times: wait for the visitor's app to send one.
      await stopChecking();
      return {subscriber:true,sent};
    }
  }catch(e){console.warn(`Subscriber ${doc.id} failed`,e?.message||e);}
  if(Number(stored)!==next)await doc.ref.set({[PRAYER_NEXT_FIELD]:next},{merge:true});
  return {subscriber:true,sent};
}

async function processPrayerNotifications(){
  const now=Date.now(),stateRef=db.doc(PRAYER_STATE_DOC),state=await stateRef.get();
  const syncedAt=state.exists?Number(state.get('syncedAtMs'))||0:0;
  const docs=new Map();
  let syncedTo=now,fullScan=false;
  if(!syncedAt){
    // First run with this scheduler version: one full pass gives every subscriber its next check time.
    const all=await db.collection(PUSH_COLLECTION).where('active','==',true).get();
    all.docs.forEach(d=>docs.set(d.id,d));
    fullScan=true;
  }else{
    // Subscriptions the visitor created or changed (new token, place, time zone, categories, opt-out).
    const changed=await db.collection(PUSH_COLLECTION).where('updatedAt','>',Timestamp.fromMillis(syncedAt-PRAYER_SYNC_OVERLAP_MS)).orderBy('updatedAt').limit(PRAYER_PAGE).get();
    changed.docs.forEach(d=>docs.set(d.id,d));
    if(changed.size===PRAYER_PAGE){const last=changed.docs[changed.size-1].get('updatedAt');syncedTo=(last&&typeof last.toMillis==='function'?last.toMillis():now)+PRAYER_SYNC_OVERLAP_MS;}
  }
  const due=await db.collection(PUSH_COLLECTION).where(PRAYER_NEXT_FIELD,'<=',now).limit(PRAYER_PAGE).get();
  due.docs.forEach(d=>docs.set(d.id,d));
  const cache=new Map();let sent=0,subscribers=0;
  for(const doc of docs.values()){
    try{const r=await processPrayerSubscriber(doc,cache);if(r.subscriber)subscribers++;sent+=r.sent;}
    catch(e){console.warn(`Subscriber ${doc.id} failed`,e?.message||e);}
  }
  await stateRef.set({syncedAtMs:Math.min(syncedTo,now),updatedAt:FieldValue.serverTimestamp()},{merge:true});
  return {checked:docs.size,subscribers,sent,fullScan};
}

(async()=>{
  const jobs=await processJobs();
  const prayers=await processPrayerNotifications();
  // Deen Friends events are independent: a failure there must never block prayer or queued reminders.
  let deenFriends;
  try{deenFriends=await processDeenFriendsEvents(db,messaging);}catch(e){console.warn('Deen Friends notifications failed',e?.message||e);deenFriends={error:String(e?.message||e)};}
  // V3 maintenance (RISE chat 24h retention, friend suggestions) is also independent of the rest.
  let maintenance;
  try{maintenance=await runMaintenance(db);}catch(e){console.warn('Maintenance failed',e?.message||e);maintenance={error:String(e?.message||e)};}
  // V3.5 trusted admin jobs (Super Admin–requested member deletion), independent of the rest.
  let adminJobs;
  try{adminJobs=await processAdminJobs(db,getAuth());}catch(e){console.warn('Admin jobs failed',e?.message||e);adminJobs={error:String(e?.message||e)};}
  // Admin Console automation: today's scheduled Daily Deen Challenges, then queued RISE outreach.
  // Each is independent of everything above; a failure is logged and retried on the next run.
  let challengeSchedule;
  try{challengeSchedule=await runChallengeSchedule(db);}catch(e){console.warn('Challenge schedule failed',e?.message||e);challengeSchedule={error:String(e?.message||e)};}
  let riseOutreach;
  try{riseOutreach=await processRiseBroadcasts(db,getAuth());}catch(e){console.warn('RISE outreach failed',e?.message||e);riseOutreach={error:String(e?.message||e)};}
  console.log(JSON.stringify({ok:true,at:new Date().toISOString(),jobs,prayers,deenFriends,maintenance,adminJobs,challengeSchedule,riseOutreach}));
})().catch(error=>{console.error(error);process.exit(1);});
