/* Admin › Dashboard: an overview of the website, Deen Friends, challenges and RISE, built only from
 * real Firestore data (services/adminInsights.ts). Each card states its source and any read limit;
 * a card whose data could not be read says so instead of showing zeros. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clearInsightsCache, contentSummary, INSIGHT_TZ, LIMITS, loadInsights, type Insights } from '../services/adminInsights';
import { Card, ColumnChart, Empty, LineChart, Loading, PageHead, RankBars, StatTile, fmtDateTime } from './ui';
import { AdminIcon } from '../components/AdminIcon';

type Range = 7 | 30;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const label = (d: string) => {
  const [, m, day] = d.split('-').map(Number);
  return `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
};
const TYPE_LABELS: Record<string, string> = {
  name: 'Names of Allah',
  dua: 'Duas',
  hadith: 'Hadith',
  reminder: 'Reminders',
  zikr: 'Zikr',
  sadaqah: 'Sadaqah requests',
};

function go(view: string) {
  document.querySelector<HTMLButtonElement>(`.admin-nav [data-admin-view="${view}"]`)?.click();
}

function Unavailable({ error }: { error?: string }) {
  return <div className="rad-alert rad-alert-error">This data could not be loaded: {error || 'unknown error'}.</div>;
}

export function AdminOverview() {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<Range>(7);
  const content = useMemo(() => contentSummary(), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async (force: boolean) => {
    setBusy(true);
    setError('');
    try {
      if (force) clearInsightsCache();
      setData(await loadInsights(force));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The dashboard could not be loaded.');
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    loadInsights(false)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'The dashboard could not be loaded.'));
    return () => {
      alive = false;
    };
  }, []);

  const slice = <T,>(arr: T[]) => arr.slice(-range);
  const days = data ? slice(data.days).map(label) : [];
  const v = data?.visitors;
  const m = data?.members;
  const a = data?.activity;
  const c = data?.challenges;
  const r = data?.rise;
  const rep = data?.reports;
  const loading = !data && !error;

  return (
    <div className="rad-overview">
      <PageHead
        kicker="Overview"
        title="Dashboard"
        description={
          <>
            How Rise Upon Deen is doing. Days are counted in India Standard Time ({INSIGHT_TZ}).
            {data ? <> Updated {fmtDateTime(data.loadedAt)}.</> : null}
          </>
        }
        actions={
          <>
            <div className="rad-seg" role="group" aria-label="Date range">
              {([7, 30] as Range[]).map((n) => (
                <button aria-pressed={range === n} className={range === n ? 'active' : ''} key={n} onClick={() => setRange(n)} type="button">
                  {n} days
                </button>
              ))}
            </div>
            <button className={`rad-btn${busy ? ' is-busy' : ''}`} disabled={busy} onClick={() => void refresh(true)} type="button">
              {busy ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />
      {error ? <div className="rad-alert rad-alert-error">{error}</div> : null}

      <div className="rad-stats">
        <StatTile
          icon="analytics"
          label="Website visitors"
          loading={loading}
          meta={v?.ok ? `${sum(slice(v.data.sessionsByDay)).toLocaleString()} sessions · ${range} days` : v?.error || ''}
          value={v?.ok ? sum(slice(v.data.uniqueByDay)).toLocaleString() : '—'}
        />
        <StatTile
          icon="friends"
          label="Deen Friends members"
          loading={loading}
          meta={m?.ok ? `+${sum(slice(m.data.newByDay))} new in ${range} days` : m?.error || ''}
          value={m?.ok ? `${m.data.total.toLocaleString()}${m.capped ? '+' : ''}` : '—'}
        />
        <StatTile
          icon="challenges"
          label="Active members"
          loading={loading}
          meta={a?.ok ? `member-days with a completed deed · ${range} days` : a?.error || ''}
          value={a?.ok ? sum(slice(a.data.activeByDay)).toLocaleString() : '—'}
        />
        <StatTile
          icon="names"
          label="Challenge completions"
          loading={loading}
          meta={c?.ok ? `daily check-ins · ${range} days` : c?.error || ''}
          value={c?.ok ? sum(slice(c.data.completionsByDay)).toLocaleString() : '—'}
        />
        <StatTile
          icon="inbox"
          label="RISE conversations"
          loading={loading}
          meta={r?.ok ? `${r.data.unread} awaiting a reply · ${r.data.resolved} solved` : r?.error || ''}
          value={r?.ok ? `${r.data.open} open` : '—'}
        />
        <StatTile
          icon="hadith"
          label="Published content"
          meta={`${content.total - content.published} drafts · ${content.scheduled} scheduled`}
          value={content.published.toLocaleString()}
        />
      </div>

      {loading ? <Loading>Loading dashboard data…</Loading> : null}

      {data ? (
        <>
          <div className="rad-grid-wide">
            <Card
              title="Website visitors"
              subtitle={`Unique visitors and sessions per day${v?.capped ? ` · based on the latest ${LIMITS.sessions.toLocaleString()} sessions` : ''}`}
              actions={
                <button className="rad-link-btn" onClick={() => go('analytics')} type="button">
                  Visitor analytics →
                </button>
              }
            >
              {v?.ok ? (
                sum(v.data.sessionsByDay) ? (
                  <LineChart
                    ariaLabel="Unique visitors and sessions per day"
                    labels={days}
                    series={[
                      { name: 'Unique visitors', values: slice(v.data.uniqueByDay) },
                      { name: 'Sessions', values: slice(v.data.sessionsByDay) },
                    ]}
                  />
                ) : (
                  <Empty>No visitor sessions recorded in the last 30 days.</Empty>
                )
              ) : (
                <Unavailable error={v?.error} />
              )}
            </Card>
            <Card title="Most visited sections" subtitle="Sessions by section, last 30 days">
              {v?.ok ? <RankBars items={v.data.topRoutes} empty="No sessions yet." /> : <Unavailable error={v?.error} />}
            </Card>
          </div>

          <div className="rad-grid-2">
            <Card
              title="Deen Friends activity"
              subtitle={`Members who completed a deed each day, and new sign-ups${a?.capped ? ` · limited to ${LIMITS.activity.toLocaleString()} records` : ''}`}
              actions={
                <button className="rad-link-btn" onClick={() => go('deen-friends')} type="button">
                  Deen Friends →
                </button>
              }
            >
              {a?.ok && m?.ok ? (
                sum(a.data.activeByDay) + sum(m.data.newByDay) ? (
                  <LineChart
                    ariaLabel="Active members and new members per day"
                    labels={days}
                    series={[
                      { name: 'Active members', values: slice(a.data.activeByDay) },
                      { name: 'New members', values: slice(m.data.newByDay) },
                    ]}
                  />
                ) : (
                  <Empty>No Deen Friends activity in the last 30 days.</Empty>
                )
              ) : (
                <Unavailable error={a?.error || m?.error} />
              )}
            </Card>
            <Card
              title="Daily challenge check-ins"
              subtitle={`Completed days recorded by members${c?.capped ? ` · first ${LIMITS.participants} participants per challenge` : ''}`}
              actions={
                <button className="rad-link-btn" onClick={() => go('daily-challenges')} type="button">
                  Challenges →
                </button>
              }
            >
              {c?.ok ? (
                sum(c.data.completionsByDay) ? (
                  <ColumnChart ariaLabel="Challenge check-ins per day" labels={days} name="Check-ins" values={slice(c.data.completionsByDay)} />
                ) : (
                  <Empty>No challenge check-ins in the last 30 days.</Empty>
                )
              ) : (
                <Unavailable error={c?.error} />
              )}
            </Card>
          </div>

          <div className="rad-grid-3">
            <Card title="Recent challenges" subtitle="Participants · completed">
              {c?.ok ? (
                <RankBars
                  empty="No published challenges in the last 30 days."
                  items={c.data.rows.slice(0, 7).map((x) => ({ label: `${x.date ? `${x.date.slice(5)} · ` : ''}${x.title}`, value: x.participants, meta: `· ${x.completed} done` }))}
                />
              ) : (
                <Unavailable error={c?.error} />
              )}
            </Card>
            <Card
              title="RISE inbox"
              subtitle={`Conversations active per day${r?.capped ? ` · latest ${LIMITS.threads}` : ''}`}
              actions={
                <button className="rad-link-btn" onClick={() => go('rise-inbox')} type="button">
                  Open inbox →
                </button>
              }
            >
              {r?.ok ? (
                r.data.total ? (
                  <>
                    <ColumnChart ariaLabel="RISE conversations active per day" height={160} labels={days} name="Conversations" values={slice(r.data.activeByDay)} />
                    <RankBars
                      items={[
                        { label: 'Open', value: r.data.open },
                        { label: 'Awaiting reply', value: r.data.unread },
                        { label: 'Solved', value: r.data.resolved },
                      ]}
                    />
                  </>
                ) : (
                  <Empty>No RISE conversations yet.</Empty>
                )
              ) : (
                <Unavailable error={r?.error} />
              )}
            </Card>
            <Card title="Content library" subtitle="Published · drafts">
              <RankBars
                empty="No content yet."
                items={Object.entries(content.types)
                  .map(([t, n]) => ({ label: TYPE_LABELS[t] || t, value: n.published, meta: `· ${n.draft} draft${n.draft === 1 ? '' : 's'}` }))
                  .sort((x, y) => y.value - x.value)}
              />
            </Card>
          </div>

          <div className="rad-grid-2">
            <Card title="Trust & safety" subtitle="Member reports">
              {rep?.ok ? (
                <div className="rad-list">
                  <div className="rad-list-item">
                    <div className="rad-list-main">
                      <strong>
                        {rep.data.open} open report{rep.data.open === 1 ? '' : 's'}
                      </strong>
                      <small>
                        {rep.data.total}
                        {rep.capped ? '+' : ''} reports in total
                      </small>
                    </div>
                    <button className="rad-btn rad-btn-sm" onClick={() => go('deen-friends')} type="button">
                      Review
                    </button>
                  </div>
                  {m?.ok && m.data.disabled ? (
                    <div className="rad-list-item">
                      <div className="rad-list-main">
                        <strong>{m.data.disabled} member account(s) disabled or pending deletion</strong>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <Unavailable error={rep?.error} />
              )}
            </Card>
            <Card title="Quick actions">
              <div className="rad-actions">
                <button className="rad-btn" onClick={() => go('rise-messages')} type="button">
                  <AdminIcon name="messages" size={16} /> Message members
                </button>
                <button className="rad-btn" onClick={() => go('daily-challenges')} type="button">
                  <AdminIcon name="challenges" size={16} /> Challenge schedule
                </button>
                <button className="rad-btn" onClick={() => go('notifications')} type="button">
                  <AdminIcon name="notifications" size={16} /> Send notification
                </button>
                <button className="rad-btn" onClick={() => go('maintenance')} type="button">
                  <AdminIcon name="maintenance" size={16} /> Maintenance
                </button>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
