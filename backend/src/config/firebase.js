import admin from "firebase-admin";

const projectId = process.env.FIREBASE_PROJECT_ID || "hr-app-local";
const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;

if (!admin.apps.length) {
  admin.initializeApp({
    projectId,
    storageBucket,
  });
}

export const db = admin.firestore();
export const bucket = admin.storage().bucket();
export { admin };
