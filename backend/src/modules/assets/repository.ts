import type { Db } from '../../db/client';
import type { AssetKind } from './validation';

export interface AssetRow {
  id: string;
  letter_id: string | null;
  kind: AssetKind;
  mime: string;
  width: number;
  height: number;
  byte_size: number;
  data: Uint8Array;
  upload_token_hash: string | null;
  attached: number;
  created_at: number;
}

export interface NewAsset {
  id: string;
  kind: AssetKind;
  mime: string;
  width: number;
  height: number;
  byteSize: number;
  data: Uint8Array;
  uploadTokenHash: string;
  createdAt: number;
}

type SqlValue = string | number | null | Uint8Array;

function one<T>(db: Db, sql: string, ...params: SqlValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function changes(db: Db, sql: string, ...params: SqlValue[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}

export function insertAsset(db: Db, input: NewAsset): void {
  db.prepare(`
    INSERT INTO letter_assets (
      id, letter_id, kind, mime, width, height, byte_size, data,
      upload_token_hash, attached, created_at
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    input.id,
    input.kind,
    input.mime,
    input.width,
    input.height,
    input.byteSize,
    input.data,
    input.uploadTokenHash,
    input.createdAt,
  );
}

export function findAssetById(db: Db, id: string): AssetRow | undefined {
  return one<AssetRow>(
    db,
    `SELECT id, letter_id, kind, mime, width, height, byte_size, data,
            upload_token_hash, attached, created_at
       FROM letter_assets WHERE id = ?`,
    id,
  );
}

export function findAttachedAsset(db: Db, id: string, letterId: string): AssetRow | undefined {
  return one<AssetRow>(
    db,
    `SELECT id, letter_id, kind, mime, width, height, byte_size, data,
            upload_token_hash, attached, created_at
       FROM letter_assets
      WHERE id = ? AND letter_id = ? AND attached = 1`,
    id,
    letterId,
  );
}

/** CAS: só o portador do token e um asset ainda não anexado podem ser vinculados. */
export function attachAsset(
  db: Db,
  params: { id: string; letterId: string; uploadTokenHash: string },
): boolean {
  return changes(
    db,
    `UPDATE letter_assets
        SET letter_id = ?, attached = 1, upload_token_hash = NULL
      WHERE id = ?
        AND attached = 0
        AND letter_id IS NULL
        AND upload_token_hash = ?`,
    params.letterId,
    params.id,
    params.uploadTokenHash,
  ) === 1;
}

/** Assets nunca reivindicados são descartados após uma hora. */
export function deleteOrphanAssets(db: Db, olderThan: number): number {
  return changes(
    db,
    `DELETE FROM letter_assets
      WHERE attached = 0 AND letter_id IS NULL AND created_at < ?`,
    olderThan,
  );
}
