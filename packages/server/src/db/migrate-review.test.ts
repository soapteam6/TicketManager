import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import { fromRoot } from '../lib/paths.js';

it('upgrades a pre-review synthetic database without losing inventory, contact, request, allocation or attendance', () => {
  const legacy = new Database(':memory:');
  try {
    legacy.pragma('foreign_keys = ON');
    legacy.exec('CREATE TABLE _migrations(id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const directory = fromRoot('packages/server/src/db/migrations');
    for (const name of readdirSync(directory).filter((n) => n.endsWith('.sql') && n < '0011').sort()) {
      legacy.exec(readFileSync(`${directory}/${name}`, 'utf8'));
      legacy.prepare('INSERT INTO _migrations VALUES (?,?)').run(name,1);
    }
    legacy.exec(`
      INSERT INTO teams(id,name,abbreviation,created_at) VALUES(1,'Legacy Synthetic','LEG',1);
      INSERT INTO seasons(id,team_id,label,start_date,end_date,status,created_at) VALUES(1,1,'Legacy season',1,2,'completed',1);
      INSERT INTO games(id,season_id,game_date,opponent,created_at) VALUES(1,1,1,'Synthetic opponent',1);
      INSERT INTO seats(id,game_id,section,row,seat_number,status,created_at) VALUES(1,1,'GA','GA','1','assigned',1);
      INSERT INTO contacts(id,public_id,type,full_name,email,phone,is_active,created_at,updated_at) VALUES(1,'legacy-contact','customer','Synthetic person','legacy@example.invalid','+1 202 555 0100',0,1,1);
      INSERT INTO ticket_requests(id,public_id,game_id,beneficiary_contact_id,quantity,created_at,updated_at) VALUES(1,'legacy-request',1,1,1,1,1);
      INSERT INTO assignments(id,request_id,seat_id,game_id,beneficiary_contact_id,status,created_at,updated_at) VALUES(1,1,1,1,1,'approved',1,1);
      INSERT INTO attendance_records(assignment_id,game_id,contact_id,ticket_status,designation,created_at,updated_at) VALUES(1,1,1,'attended','customer',1,1);
    `);
    expect(runMigrations(legacy)).toEqual(['0011_inventory_release.sql','0012_attendance_unknown.sql']);
    expect(legacy.prepare('SELECT release_status,release_at FROM games').get()).toEqual({release_status:'private',release_at:null});
    expect(legacy.prepare('SELECT is_active,directory_active,phone FROM contacts').get()).toEqual({is_active:0,directory_active:1,phone:'+1 202 555 0100'});
    for (const table of ['games','contacts','ticket_requests','assignments','attendance_records']) expect(legacy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({n:1});
    legacy.exec("UPDATE attendance_records SET ticket_status='unknown'");
    expect(runMigrations(legacy)).toEqual([]);
    expect(legacy.pragma('foreign_key_check')).toEqual([]);
  } finally { legacy.close(); }
});
