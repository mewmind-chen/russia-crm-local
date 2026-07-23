const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

async function createPermissionFixture(appOptions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-permissions-'));
  const dbPath = path.join(dir, 'crm.db');
  if (process.env.CRM_FIXTURE_BASE_DB) {
    fs.copyFileSync(path.resolve(process.env.CRM_FIXTURE_BASE_DB), dbPath);
  }
  const previousDbPath = process.env.CRM_DB_PATH;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.CRM_DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';

  const { installSalesCrm } = require('../../lib/sales_crm');
  const { ensureTables } = require('../../lib/db');
  const { createApp } = require('../../server');
  installSalesCrm();
  ensureTables();

  const db = new Database(dbPath);
  const server = createApp(appOptions).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    dir,
    dbPath,
    db,
    baseUrl,
    async login(email, password) {
      const response = await fetch(`${baseUrl}/api/sales-auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return String(response.headers.get('set-cookie') || '').split(';')[0];
    },
    request(route, { cookie = '', method = 'GET', body } = {}) {
      return fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    },
    setUserPermissions(userId, patch) {
      const group = db.prepare(`SELECT g.permissions_json FROM sales_users u
        JOIN permission_groups g ON g.id=u.permission_group_id WHERE u.id=?`).get(userId);
      const defaults = JSON.parse(group.permissions_json);
      const now = '2026-07-21 08:00:00';
      for (const [permission, desired] of Object.entries(patch)) {
        db.prepare('DELETE FROM user_permission_overrides WHERE user_id=? AND permission_key=?').run(userId, permission);
        if (Boolean(defaults[permission]) === Boolean(desired)) continue;
        db.prepare(`INSERT INTO user_permission_overrides
          (user_id,permission_key,effect,created_at,updated_at) VALUES (?,?,?,?,?)`)
          .run(userId, permission, desired ? 'allow' : 'deny', now, now);
      }
    },
    async close() {
      db.close();
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
      if (previousDbPath === undefined) delete process.env.CRM_DB_PATH;
      else process.env.CRM_DB_PATH = previousDbPath;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    },
  };
}

async function seededFixture(options = {}) {
  const fx = await createPermissionFixture(options.appOptions);
  const { hashPassword } = require('../../lib/sales_crm');
  const password = hashPassword('Password123!', '0123456789abcdef0123456789abcdef');
  const now = '2026-07-21 08:00:00';
  const insertUser = fx.db.prepare(`INSERT INTO sales_users
    (id,email,name,role,password_hash,password_salt,active,must_change_password,
     languages_json,countries_json,channels_json,permission_group_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,1,0,'[]','[]','[]',?,?,?)`);
  insertUser.run(
    'U-WU', 'wu@example.com', 'Wu', 'manager', password.hash, password.salt,
    'PGRP-MANAGER-DEFAULT', now, now,
  );
  insertUser.run(
    'U-MGR', 'manager@example.com', 'Manager', 'manager', password.hash, password.salt,
    'PGRP-MANAGER-DEFAULT', now, now,
  );
  insertUser.run(
    'U-OTHER', 'other@example.com', 'Other', 'sales', password.hash, password.salt,
    'PGRP-SALES-DEFAULT', now, now,
  );
  fx.setUserPermissions('U-WU', { view_development: true, view_contacts: false, ...options.permissions });
  fx.setUserPermissions('U-MGR', { view_all_customers: options.managerViewAll !== false, ...options.permissions });

  const insertAccount = fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,created_at,updated_at)
    VALUES (?,?,?,?,'qualified','claimed',?,?)`);
  insertAccount.run('CRM-WU', 'RU-9001', 'Wu Fixture', 'U-WU', now, now);
  insertAccount.run('CRM-OWN', 'RU-9002', 'Owned Fixture', 'U-MGR', now, now);
  insertAccount.run('CRM-OTHER', 'RU-9003', 'Other Fixture', 'U-OTHER', now, now);

  const insertPool = fx.db.prepare('INSERT INTO customer_pool(customer_id,company_name) VALUES (?,?)');
  insertPool.run('RU-9001', 'Wu Fixture');
  insertPool.run('RU-9002', 'Owned Fixture');
  insertPool.run('RU-9003', 'Other Fixture');
  const insertCustomer = fx.db.prepare(`INSERT INTO customers
    (follow_id,customer_id,company_name,email,phone,contact,status) VALUES (?,?,?,?,?,?,?)`);
  insertCustomer.run(
    'FOLLOW-WU', 'RU-9001', 'Wu Fixture',
    'person@secret.test', '+7-secret', 'Verified Buyer', '未分配',
  );
  insertCustomer.run('FOLLOW-OWN', 'RU-9002', 'Owned Fixture', '', '', '', '未分配');
  insertCustomer.run('FOLLOW-OTHER', 'RU-9003', 'Other Fixture', '', '', '', '未分配');
  fx.db.prepare(`INSERT INTO recon_results(job_id,customer_id,company_name,email,phone,updated_at)
    VALUES ('JOB-OWN','RU-9002','Owned Fixture','','','2026-07-21 08:00:00'),
           ('JOB-OTHER','RU-9003','Other Fixture','hidden@secret.test','+7-other','2026-07-21 08:00:00')`).run();
  fx.db.prepare(`INSERT INTO recon_jobs(job_id,customer_id,company_name,status,requested_at,updated_at)
    VALUES ('JOB-OWN','RU-9002','Owned Fixture','done',?,?),
           ('JOB-OTHER','RU-9003','Other Fixture','done',?,?)`).run(now, now, now, now);
  fx.db.prepare(`INSERT INTO contact_recon_jobs(job_id,customer_id,company_name,status,created_at,updated_at)
    VALUES ('CONTACT-WU','RU-9001','Wu Fixture','done',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO person_candidates
    (person_id,customer_id,contact_recon_job_id,full_name,title,first_found_at,created_at,updated_at)
    VALUES ('PERSON-WU','RU-9001','CONTACT-WU','Verified Buyer','Procurement',?,?,?)`).run(now, now, now);
  fx.db.prepare(`INSERT INTO contact_methods
    (contact_id,person_id,customer_id,method_type,value,normalized_value,status)
    VALUES ('METHOD-WU','PERSON-WU','RU-9001','email','person@secret.test','person@secret.test','verified')`).run();
  fx.db.prepare(`INSERT INTO crm_intake_batches(id,batch_date,status,created_at)
    VALUES ('BATCH-TEST','2026-07-21','done',?)`).run(now);
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-OTHER','BATCH-TEST','BR-9004','Intake Other','assigned','U-OTHER',?,?)`).run(now, now);

  const activeEmail = options.managerViewAll === false ? 'manager@example.com' : 'wu@example.com';
  fx.cookie = await fx.login(activeEmail, 'Password123!');
  return fx;
}

async function fixtureWithPermission(permission, value) {
  return seededFixture({ permissions: { [permission]: value } });
}

async function adminFixture(options = {}) {
  const fx = await seededFixture(options);
  const { hashPassword } = require('../../lib/sales_crm');
  const password = hashPassword('Admin123!', 'abcdef0123456789abcdef0123456789');
  fx.db.prepare(`UPDATE sales_users SET email='admin@example.com',password_hash=?,password_salt=?,
    must_change_password=0,active=1 WHERE id='USR-ADMIN'`).run(password.hash, password.salt);
  if (options.adminCount === 2) {
    fx.db.prepare(`INSERT INTO sales_users
      (id,email,name,role,password_hash,password_salt,active,must_change_password,
       languages_json,countries_json,channels_json,permissions_json,permission_group_id,created_at,updated_at)
      SELECT 'U-ADMIN2','admin2@example.com','Admin Two','admin',password_hash,password_salt,1,0,
       '[]','[]','[]','{}',permission_group_id,created_at,updated_at FROM sales_users WHERE id='USR-ADMIN'`).run();
  }
  fx.adminCookie = await fx.login('admin@example.com', 'Admin123!');
  fx.otherCookie = await fx.login('other@example.com', 'Password123!');
  fx.adminGroupId = fx.db.prepare("SELECT id FROM permission_groups WHERE system_key='admin-default'").get().id;
  fx.managerGroupId = fx.db.prepare("SELECT id FROM permission_groups WHERE system_key='manager-default'").get().id;
  fx.salesGroupId = fx.db.prepare("SELECT id FROM permission_groups WHERE system_key='sales-default'").get().id;
  fx.requestJson = async (route, options) => (await fx.request(route, options)).json();
  fx.loginStatus = async (email, candidate) => {
    const response = await fetch(`${fx.baseUrl}/api/sales-auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: candidate }),
    });
    return response.status;
  };
  fx.startImpersonation = async targetUserId => {
    const response = await fx.request('/api/sales-crm/impersonation/start', {
      cookie: fx.adminCookie, method: 'POST', body: { targetUserId },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  fx.expireCurrentImpersonation = () => {
    fx.db.prepare(`UPDATE sales_sessions SET impersonation_expires_at='2000-01-01 00:00:00'
      WHERE impersonation_context_id!=''`).run();
  };
  return fx;
}

module.exports = { createPermissionFixture, seededFixture, fixtureWithPermission, adminFixture };
