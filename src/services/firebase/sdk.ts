/* Firebase JS SDK loader — the one place the SDK is imported.
 *
 * The original page loaded the SDK with dynamic import() from the gstatic CDN on purpose: if the
 * SDK cannot load (offline, blocked, slow) the rest of the app keeps working in cached/static mode
 * and Firebase is simply reported as unavailable. The same contract is kept here with the npm SDK:
 * the modules are code-split chunks that start downloading as soon as the app boots, and every
 * SDK function is exposed as a live binding that is filled in once the chunks have loaded.
 */
import type * as AppMod from 'firebase/app';
import type * as AuthMod from 'firebase/auth';
import type * as FirestoreMod from 'firebase/firestore';
import type * as StorageMod from 'firebase/storage';
import type * as MessagingMod from 'firebase/messaging';

export let initializeApp: typeof AppMod.initializeApp;
export let deleteApp: typeof AppMod.deleteApp;

export let getAuth: typeof AuthMod.getAuth;
export let initializeAuth: typeof AuthMod.initializeAuth;
export let indexedDBLocalPersistence: typeof AuthMod.indexedDBLocalPersistence;
export let browserLocalPersistence: typeof AuthMod.browserLocalPersistence;
export let signInWithEmailAndPassword: typeof AuthMod.signInWithEmailAndPassword;
export let createUserWithEmailAndPassword: typeof AuthMod.createUserWithEmailAndPassword;
export let sendPasswordResetEmail: typeof AuthMod.sendPasswordResetEmail;
export let updatePassword: typeof AuthMod.updatePassword;
export let signInAnonymously: typeof AuthMod.signInAnonymously;
export let signOut: typeof AuthMod.signOut;
export let onAuthStateChanged: typeof AuthMod.onAuthStateChanged;

export let getFirestore: typeof FirestoreMod.getFirestore;
export let initializeFirestore: typeof FirestoreMod.initializeFirestore;
export let collection: typeof FirestoreMod.collection;
export let doc: typeof FirestoreMod.doc;
export let addDoc: typeof FirestoreMod.addDoc;
export let setDoc: typeof FirestoreMod.setDoc;
export let updateDoc: typeof FirestoreMod.updateDoc;
export let deleteDoc: typeof FirestoreMod.deleteDoc;
export let query: typeof FirestoreMod.query;
export let where: typeof FirestoreMod.where;
export let orderBy: typeof FirestoreMod.orderBy;
export let limit: typeof FirestoreMod.limit;
export let startAfter: typeof FirestoreMod.startAfter;
export let getDoc: typeof FirestoreMod.getDoc;
export let getDocs: typeof FirestoreMod.getDocs;
export let onSnapshot: typeof FirestoreMod.onSnapshot;
export let serverTimestamp: typeof FirestoreMod.serverTimestamp;
export let writeBatch: typeof FirestoreMod.writeBatch;
export let runTransaction: typeof FirestoreMod.runTransaction;

export let getStorage: typeof StorageMod.getStorage;
export let storageRef: typeof StorageMod.ref;
export let uploadBytesResumable: typeof StorageMod.uploadBytesResumable;
export let getDownloadURL: typeof StorageMod.getDownloadURL;

export let firebaseSdkLoaded = false;

let sdkPromise: Promise<boolean> | null = null;

/** Starts (once) downloading the Firebase SDK chunks. Resolves true when ready, false when unavailable. */
export function loadFirebaseSdk(): Promise<boolean> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
    import('firebase/storage'),
  ])
    .then(([appMod, authMod, storeMod, storageMod]) => {
      ({ initializeApp, deleteApp } = appMod);
      ({
        getAuth,
        initializeAuth,
        indexedDBLocalPersistence,
        browserLocalPersistence,
        signInWithEmailAndPassword,
        createUserWithEmailAndPassword,
        sendPasswordResetEmail,
        updatePassword,
        signInAnonymously,
        signOut,
        onAuthStateChanged,
      } = authMod);
      ({
        getFirestore,
        initializeFirestore,
        collection,
        doc,
        addDoc,
        setDoc,
        updateDoc,
        deleteDoc,
        query,
        where,
        orderBy,
        limit,
        startAfter,
        getDoc,
        getDocs,
        onSnapshot,
        serverTimestamp,
        writeBatch,
        runTransaction,
      } = storeMod);
      ({ getStorage, ref: storageRef, uploadBytesResumable, getDownloadURL } = storageMod);
      firebaseSdkLoaded = true;
      return true;
    })
    .catch((sdkErr: unknown) => {
      console.error('Firebase SDK failed to load (network/CDN unavailable). Continuing in cached/static mode.', sdkErr);
      return false;
    });
  return sdkPromise;
}

/** Same promise the original page exposed as `firebaseSdkPromise` (download starts when this module is evaluated). */
export const firebaseSdkPromise: Promise<boolean> = loadFirebaseSdk();

/** Firebase Cloud Messaging is only loaded after the visitor opts in to notifications. */
export function loadMessagingSdk(): Promise<typeof MessagingMod> {
  return import('firebase/messaging');
}
