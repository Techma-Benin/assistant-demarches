import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Storage } from "@google-cloud/storage";
import { approvedMcpUrl } from "./domain.js";

export interface ObjectStorage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
const validKey = (key: string) => {
  if (!/^fil_[0-9A-HJKMNP-TV-Z]{26}$/.test(key))
    throw new Error("Invalid object key.");
  return key;
};
export class LocalStorage implements ObjectStorage {
  constructor(private directory: string) {
    this.directory = resolve(directory);
  }
  async put(key: string, data: Buffer, _mime: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(join(this.directory, validKey(key)), data, {
      mode: 0o600,
      flag: "wx",
    });
  }
  read(key: string) {
    return readFile(join(this.directory, validKey(key)));
  }
  async remove(key: string) {
    await unlink(join(this.directory, validKey(key))).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
export class S3Storage implements ObjectStorage {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}
  async put(key: string, data: Buffer, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: validKey(key),
        Body: data,
        ContentType: mime,
      }),
    );
  }
  async read(key: string) {
    const value = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: validKey(key) }),
    );
    if (!value.Body) throw new Error("Missing object.");
    return Buffer.from(await value.Body.transformToByteArray());
  }
  async remove(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: validKey(key) }),
    );
  }
}
export class GcsStorage implements ObjectStorage {
  constructor(
    private client: Storage,
    private bucket: string,
  ) {}
  async put(key: string, data: Buffer, mime: string) {
    await this.client
      .bucket(this.bucket)
      .file(validKey(key))
      .save(data, {
        resumable: false,
        contentType: mime,
        preconditionOpts: { ifGenerationMatch: 0 },
      });
  }
  async read(key: string) {
    return (
      await this.client.bucket(this.bucket).file(validKey(key)).download()
    )[0];
  }
  async remove(key: string) {
    await this.client
      .bucket(this.bucket)
      .file(validKey(key))
      .delete({ ignoreNotFound: true });
  }
}
export function storageFromEnvironment(): ObjectStorage {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "local")
    return new LocalStorage(
      process.env.FILE_STORAGE_DIR ?? process.env.STORAGE_LOCAL_DIRECTORY ?? "./.backend-files",
    );
  const bucket = process.env.STORAGE_BUCKET;
  if (!bucket) throw new Error("STORAGE_BUCKET required.");
  if (driver === "gcs") return new GcsStorage(new Storage(), bucket);
  if (
    process.env.S3_ENDPOINT &&
    !approvedMcpUrl(
      process.env.S3_ENDPOINT,
      new Set([new URL(process.env.S3_ENDPOINT).href]),
    )
  )
    throw new Error("Storage endpoint requires HTTPS outside localhost.");
  if (driver === "s3")
    return new S3Storage(
      new S3Client({
        region: process.env.AWS_REGION ?? "us-east-1",
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      }),
      bucket,
    );
  throw new Error("Unsupported storage driver.");
}
