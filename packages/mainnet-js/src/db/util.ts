import { StorageProvider } from ".";
import { getRuntimePlatform } from "../util/index";
import { default as IndexedDBProvider } from "./IndexedDBProvider";
import { default as SqlProvider } from "./SqlProvider";
import { sslConfigI } from "./interface";

export function getStorageProvider(
  dbName: string
): StorageProvider | undefined {
  if (getRuntimePlatform() !== "node" && indexedDbIsAvailable()) {
    return new IndexedDBProvider(dbName);
  } else {
    if ("DATABASE_URL" in process.env) {
      return new SqlProvider(dbName);
    } else {
      console.warn("DATABASE_URL was not configured, storage unavailable");
      return;
    }
  }
}

export function indexedDbIsAvailable() {
  return "indexedDB" in globalThis;
}

export function getSslConfig(): sslConfigI | undefined {
  const ca = process.env.DATABASE_SSL_CA
    ? Buffer.from(process.env.DATABASE_SSL_CA, "base64").toString("ascii")
    : undefined;
  const key = process.env.DATABASE_SSL_KEY
    ? Buffer.from(process.env.DATABASE_SSL_KEY, "base64").toString("ascii")
    : undefined;
  const cert = process.env.DATABASE_SSL_CERT
    ? Buffer.from(process.env.DATABASE_SSL_CERT, "base64").toString("ascii")
    : undefined;
  let ssl: sslConfigI = {
    rejectUnauthorized:
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED == "false" ? false : true,
    ca: ca,
    key: key,
    cert: cert,
  };
  if (ssl.ca || ssl.cert || ssl.key) {
    return ssl;
  } else {
    return;
  }
}
