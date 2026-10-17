/**
 * Fills a development database with a believable Bengaluru: demo users, two crews,
 * a week of walks, a sponsor drop and a city-wars challenge. Never run against production.
 *
 *   npm run seed:demo -w @unfog/server
 *   npm run seed:demo -w @unfog/server -- you@example.com   # also puts your account in a crew
 */
import { addDays, cellDisk, dayKey, latLngToCell, getCity } from '@unfog/core';
import { loadConfig } from '../src/config';
import { createPool } from '../src/db';
import { migrate } from '../src/migrate';
import { adminCreateChallenge, joinChallenge } from '../src/services/challenges';
import { createCrew, joinCrew } from '../src/services/crews';
import { adminCreateDrop } from '../src/services/drops';
import { ingestVisits } from '../src/services/visits';

const config = loadConfig();
if (config.nodeEnv === 'production') throw new Error('Refusing to seed a production database');
const db = createPool(config.databaseUrl, config.databaseSsl);
await migrate(db);

const city = getCity('blr')!;
const today = dayKey(new Date(), city.tzOffsetMinutes);
const anchor = (id: string) => city.neighbourhoods.find((n) => n.id === id)!;

async function user(username: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, username, display_name) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
    [`${username}@demo.unfog.app`, username, username[0]!.toUpperCase() + username.slice(1)],
  );
  return rows[0]!.id;
}

async function walk(userId: string, nbIds: string[], radius: number, days: number) {
  for (let d = days - 1; d >= 0; d--) {
    const day = addDays(today, -d);
    const visits = nbIds.flatMap((id) => {
      const centre = latLngToCell(anchor(id));
      return cellDisk(centre, radius)
        .filter(() => Math.random() < 0.35)
        .map((cell) => ({ cell, day }));
    });
    await ingestVisits(db, userId, visits, today);
  }
}

const people = {
  priya: await user('priya'),
  arjun: await user('arjun'),
  meera: await user('meera'),
  kabir: await user('kabir'),
  zoya: await user('zoya'),
};

await db.query('UPDATE users SET crew_id = NULL WHERE email LIKE $1', ['%@demo.unfog.app']);
await db.query(`DELETE FROM crews WHERE name IN ('Koramangala Owls', 'Indiranagar Runners')`);
const owls = await createCrew(db, people.priya, { name: 'Koramangala Owls', color: '#FF5A5F' });
const runners = await createCrew(db, people.kabir, { name: 'Indiranagar Runners', color: '#4D7CFE' });
const code = async (crewId: string) => (await db.query<{ invite_code: string }>('SELECT invite_code FROM crews WHERE id = $1', [crewId])).rows[0]!.invite_code;
await joinCrew(db, people.arjun, await code(owls));
await joinCrew(db, people.meera, await code(owls));
await joinCrew(db, people.zoya, await code(runners));

await walk(people.priya, ['koramangala', 'hsr-layout'], 8, 7);
await walk(people.arjun, ['koramangala', 'btm-layout'], 6, 5);
await walk(people.meera, ['jayanagar'], 7, 6);
await walk(people.kabir, ['indiranagar', 'domlur'], 8, 7);
await walk(people.zoya, ['indiranagar', 'halasuru'], 6, 4);

const kora = anchor('koramangala');
await adminCreateDrop(db, {
  lat: kora.lat + 0.003,
  lng: kora.lng + 0.002,
  title: 'Free cold brew at the counter',
  note: 'Show this drop at the till. Demo data.',
  kind: 'venue',
  sponsor: 'Demo Cafe',
});

const challenge = await adminCreateChallenge(db, {
  name: 'Demo City Wars',
  cityId: 'blr',
  startsOn: addDays(today, -3),
  endsOn: addDays(today, 10),
  teams: [
    { name: 'Team Startup', color: '#FF9F1C' },
    { name: 'Team College', color: '#3DDC97' },
  ],
});
await joinChallenge(db, people.priya, challenge.teams[0]!.joinCode, today);
await joinChallenge(db, people.kabir, challenge.teams[1]!.joinCode, today);

const yourEmail = process.argv[2]?.toLowerCase();
if (yourEmail) {
  const { rows } = await db.query<{ id: string; crew_id: string | null }>('SELECT id, crew_id FROM users WHERE email = $1', [yourEmail]);
  if (rows[0] && !rows[0].crew_id) {
    await joinCrew(db, rows[0].id, await code(owls));
    console.log(`Added ${yourEmail} to Koramangala Owls.`);
  } else if (!rows[0]) {
    console.log(`${yourEmail} has not signed in yet. Sign in once in the app, then re-run.`);
  }
}

console.log(`Seeded demo data for ${today}.`);
console.log(`Crew invite codes: Owls ${await code(owls)}, Runners ${await code(runners)}`);
console.log(`Challenge codes: ${challenge.teams.map((t) => `${t.name} ${t.joinCode}`).join(', ')}`);
await db.end();
