import { escapeAttribute, escapeHtml } from '../../components/html.js';
import { renderEmptyState } from '../../components/empty-state.js';

export const id = 'administration';

const TABS = Object.freeze([
  ['users', '用户'],
  ['permissions', '权限'],
  ['identity', '身份检查'],
  ['maintenance', '数据维护'],
  ['reports', '报表'],
  ['ai', 'AI 运行'],
  ['audit', '审计'],
]);

let current = null;

function isForbidden(context) {
  return context.access.role !== 'admin'
    || !context.access.permissions?.view_users
    || !context.access.permissions?.manage_users
    || context.access.impersonating;
}

export async function load(context) {
  context.mount.innerHTML = '<div class="empty-state" role="status"><strong>正在加载系统管理…</strong></div>';
  if (isForbidden(context)) return { state: 'forbidden' };
  try {
    const controller = context.lifecycle.createAbortController();
    const payload = await context.services.session.bootstrap(
      ['core', 'administration', 'intelligence'],
      { signal: controller.signal, timeoutMs: 15000 },
    );
    const [runs, runtime, features] = await Promise.allSettled([
      context.access.permissions.manage_data_maintenance
        ? context.services.administration.maintenanceRuns({ limit: 20 }, { signal: controller.signal })
        : Promise.resolve({ runs: [] }),
      context.services.administration.assistantRuntime({ signal: controller.signal }),
      context.services.ai.features({ signal: controller.signal }),
    ]);
    return {
      state: 'ready',
      payload,
      tab: 'users',
      maintenanceRuns: runs.value?.runs || [],
      runtime: runtime.value || null,
      features: features.value?.features || {},
      optionalErrors: [runs.reason, runtime.reason, features.reason].filter(Boolean).map(error => error.message),
      maintenancePreview: null,
      busy: '',
      notice: '',
      error: '',
    };
  } catch (error) {
    return {
      state: error?.status === 403 ? 'forbidden' : 'error',
      message: error?.message || '系统管理加载失败',
    };
  }
}

function usersTab(data) {
  const users = data.payload.users || [];
  const archived = data.payload.archivedUsers || [];
  return `<section data-admin-panel="users">
    <div class="panel-head"><div><h2>用户与账号</h2><p>创建、编辑、停用、密码与归档</p></div>
      <button class="button primary" type="button" data-admin-action="create-user">新增用户</button></div>
    ${users.length ? `<div class="table-scroll"><table><thead><tr><th>用户</th><th>角色</th><th>权限组</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${users.map(user => `<tr><td><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)}</small></td>
        <td>${escapeHtml(user.role)}</td><td>${escapeHtml(user.permissionGroupName || '未分配')}</td>
        <td>${user.active ? '启用' : '停用'}</td><td>
          <button class="text-button" data-admin-action="edit-user" data-user-id="${escapeAttribute(user.id)}">编辑</button>
          <button class="text-button" data-admin-action="permission-overrides" data-user-id="${escapeAttribute(user.id)}">个人权限</button>
          <button class="text-button" data-admin-action="reset-password" data-user-id="${escapeAttribute(user.id)}">修改密码</button>
          ${['manager', 'sales'].includes(user.role) && user.active ? `<button class="text-button" data-admin-action="impersonate" data-user-id="${escapeAttribute(user.id)}">身份检查</button>` : ''}
          <button class="text-button danger-text" data-admin-action="archive-user" data-user-id="${escapeAttribute(user.id)}">归档</button>
        </td></tr>`).join('')}
    </tbody></table></div>` : renderEmptyState({ title: '暂无用户' })}
    <h3>已归档用户</h3>
    ${archived.length ? archived.map(user => `<div class="list-row"><span>${escapeHtml(user.name)} · ${escapeHtml(user.role)}</span>
      <button class="text-button" data-admin-action="restore-user" data-user-id="${escapeAttribute(user.id)}">恢复</button>
      <button class="text-button danger-text" data-admin-action="delete-user" data-user-id="${escapeAttribute(user.id)}">永久删除</button></div>`).join('') : renderEmptyState({ title: '暂无归档用户' })}
  </section>`;
}

function permissionsTab(data) {
  const groups = data.payload.permissionGroups || [];
  const definitions = data.payload.permissionDefinitions || {};
  return `<section data-admin-panel="permissions">
    <div class="panel-head"><div><h2>权限组</h2><p>组默认与用户三态覆盖分开管理</p></div>
      <button class="button primary" type="button" data-admin-action="create-group">新增权限组</button></div>
    ${groups.length ? groups.map(group => `<article class="permission-group-row">
      <div><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.role)} · ${Number(group.memberCount || 0)} 人</small></div>
      <span>${Object.values(group.permissions || {}).filter(Boolean).length} / ${Object.keys(definitions).length} 项允许</span>
      <button class="text-button" data-admin-action="edit-group" data-group-id="${escapeAttribute(group.id)}">编辑</button>
    </article>`).join('') : renderEmptyState({ title: '暂无权限组' })}
  </section>`;
}

function identityTab(data) {
  const active = (data.payload.users || []).filter(user => user.active && ['manager', 'sales'].includes(user.role));
  return `<section data-admin-panel="identity">
    <div class="panel-head"><div><h2>模拟身份检查</h2><p>只用于验证目标账号权限；进入后系统管理写入被禁止。</p></div></div>
    ${active.length ? active.map(user => `<div class="list-row"><span><strong>${escapeHtml(user.name)}</strong> · ${escapeHtml(user.role)}</span>
      <button class="button secondary" type="button" data-admin-action="impersonate" data-user-id="${escapeAttribute(user.id)}">以此身份检查</button></div>`).join('') : renderEmptyState({ title: '暂无可检查账号' })}
  </section>`;
}

function maintenanceTab(data, context) {
  if (!context.access.permissions.manage_data_maintenance) {
    return renderEmptyState({ title: '403 无权执行数据维护', description: '需要数据维护权限。' });
  }
  const preview = data.maintenancePreview;
  return `<section data-admin-panel="maintenance">
    <div class="panel-head"><div><h2>数据维护</h2><p>必须先预览影响范围，再输入确认文字执行。</p></div></div>
    <form class="form-grid" data-maintenance-preview>
      <label>批次 ID<input name="batchId"></label>
      <label>负责人 ID<input name="ownerId"></label>
      <label>线索 ID（逗号分隔）<input name="itemIds"></label>
      <label><input type="checkbox" name="allAssigned"> 全部已分配线索</label>
      <button class="button secondary">预览影响</button>
    </form>
    ${preview ? `<div class="maintenance-preview">
      <strong>影响范围：${Number(preview.counts?.intakeItems || 0)} 条线索，冲突 ${Number(preview.counts?.conflicts || 0)} 条</strong>
      <form data-maintenance-execute><label>输入确认文字 ${escapeHtml(preview.confirmationText)}
        <input name="confirmationText" required></label><button class="button danger">备份并执行</button></form>
    </div>` : renderEmptyState({ title: '尚未生成维护预览' })}
    <h3>维护运行记录</h3>
    ${data.maintenanceRuns.length ? data.maintenanceRuns.map(run =>
      `<div class="list-row"><span>${escapeHtml(run.createdAt || '')} · ${escapeHtml(run.status || '')}</span><small>${escapeHtml(run.backupFile || '无备份文件')}</small></div>`).join('')
      : renderEmptyState({ title: '暂无维护记录' })}
  </section>`;
}

function reportsTab(data, context) {
  const canExport = context.access.permissions.export_data;
  return `<section data-admin-panel="reports">
    <div class="panel-head"><div><h2>报表与导出</h2><p>经营报表与原始数据入口保持分离。</p></div></div>
    <div class="report-entry-grid">
      <a class="button secondary" href="#team-insights">团队经营与市场报表</a>
      <a class="button secondary" href="#intelligence">Recon 情报报告</a>
      ${canExport ? '<a class="button secondary" href="/api/sales-crm/export?format=csv" target="_blank" rel="noopener">导出 CRM CSV</a>' : '<span class="subtle">无数据导出权限</span>'}
      ${canExport ? '<a class="button secondary" href="/api/sales-crm/export?format=json" target="_blank" rel="noopener">导出 CRM JSON</a>' : ''}
    </div>
    <p>当前加载 ${Number(data.payload.countryReport?.length || 0)} 个国家报表、${Number(data.payload.cohortReport?.length || 0)} 个同期群报表。</p>
  </section>`;
}

function aiRuntimeTab(data) {
  const runtime = data.runtime || {};
  const features = data.features || {};
  return `<section data-admin-panel="ai">
    <div class="panel-head"><div><h2>AI 运行与功能开关</h2><p>仅管理员可见；业务结果仍需在对应客户和待办中复核。</p></div>
      <button class="button secondary" type="button" data-admin-action="recheck-runtime">重新检测</button></div>
    <div class="metric-grid">
      <article class="metric"><span>路由模式</span><strong>${escapeHtml(runtime.mode || 'auto')}</strong></article>
      <article class="metric"><span>当前引擎</span><strong>${escapeHtml(runtime.activeEngine || '暂无')}</strong></article>
      <article class="metric"><span>健康引擎</span><strong>${Object.values(runtime.engines || {}).filter(engine => engine.status === 'healthy').length}</strong></article>
      <article class="metric"><span>功能开关</span><strong>${Object.keys(features).length}</strong></article>
    </div>
    <button class="button secondary" type="button" data-admin-action="set-assistant-mode">切换路由模式</button>
    <a class="button secondary" href="#ai-control">打开 AI 运行审计与版本治理</a>
    <div class="ai-feature-list">${Object.entries(features).map(([key, feature]) => `<div class="list-row">
      <span><strong>${escapeHtml(key)}</strong> · ${feature.effectiveEnabled ? '运行中' : '已暂停'}</span>
      <button class="button secondary" type="button" data-admin-action="toggle-ai-feature"
        data-feature-key="${escapeAttribute(key)}" ${feature.hardEnabled ? '' : 'disabled'}>${feature.runtimeEnabled ? '关闭' : '开启'}</button>
    </div>`).join('') || renderEmptyState({ title: '暂无可管理的 AI 功能开关' })}</div>
  </section>`;
}

function auditTab(data) {
  const rows = data.payload.auditLog || [];
  return `<section data-admin-panel="audit"><div class="panel-head"><div><h2>审计与迁移复核</h2></div></div>
    ${rows.length ? rows.slice(0, 100).map(row => `<div class="list-row"><span>${escapeHtml(row.created_at || '')} · ${escapeHtml(row.action || '')}</span>
      <small>${escapeHtml(row.entity_type || '')} · ${escapeHtml(row.entity_id || '')}</small></div>`).join('') : renderEmptyState({ title: '暂无审计记录' })}
    <h3>迁移待确认</h3>
    ${(data.payload.migrationReview || []).length ? data.payload.migrationReview.map(review =>
      `<div class="list-row"><span>${escapeHtml(review.source_id)} · ${escapeHtml(review.reason)}</span>
      <button class="text-button" data-admin-action="resolve-review" data-review-id="${escapeAttribute(review.id)}">确认迁移</button></div>`).join('')
      : renderEmptyState({ title: '暂无迁移待确认项' })}
  </section>`;
}

function panel(data, context) {
  return {
    users: usersTab(data),
    permissions: permissionsTab(data),
    identity: identityTab(data),
    maintenance: maintenanceTab(data, context),
    reports: reportsTab(data, context),
    ai: aiRuntimeTab(data),
    audit: auditTab(data),
  }[data.tab];
}

function content(data, context) {
  return `<div class="module-workspace" data-module="${id}">
    <header class="workspace-header"><div><p class="eyebrow">系统管理</p><h1>系统管理</h1>
      <p>管理员专用，不进入经理日常工作区。</p></div></header>
    ${data.notice ? `<div class="status-banner" role="status">${escapeHtml(data.notice)}</div>` : ''}
    ${data.error ? `<div class="status-banner error" role="alert">${escapeHtml(data.error)}</div>` : ''}
    ${data.optionalErrors.length ? `<div class="status-banner warning">${escapeHtml(data.optionalErrors.join('；'))}</div>` : ''}
    <nav class="segmented-control" aria-label="系统管理模块">${TABS.map(([key, label]) =>
      `<button type="button" data-admin-tab="${key}" aria-current="${data.tab === key ? 'page' : 'false'}">${label}</button>`).join('')}</nav>
    ${panel(data, context)}
  </div>`;
}

function rerender(context, data) {
  if (!context.lifecycle.disposed) context.mount.innerHTML = content(data, context);
}

async function refresh(context, data) {
  const payload = await context.services.session.bootstrap(['core', 'administration', 'intelligence'], {
    signal: context.lifecycle.signal,
  });
  data.payload = payload;
  rerender(context, data);
}

async function adminAction(context, data, action, element) {
  const userId = element.dataset.userId;
  data.error = '';
  data.notice = '';
  try {
    if (action === 'create-user') {
      const email = globalThis.prompt?.('新用户邮箱');
      if (!email) return;
      const name = globalThis.prompt?.('用户姓名', email.split('@')[0]) || email.split('@')[0];
      const role = String(globalThis.prompt?.('角色：admin / manager / sales', 'sales') || '').trim();
      if (!['admin', 'manager', 'sales'].includes(role)) throw new Error('角色必须是 admin、manager 或 sales');
      const groups = (data.payload.permissionGroups || []).filter(group => group.role === role);
      const permissionGroupId = String(globalThis.prompt?.(
        `权限组 ID（${groups.map(group => `${group.id}:${group.name}`).join('，')}）`,
        groups[0]?.id || '',
      ) || '').trim();
      if (!permissionGroupId) throw new Error('请选择与角色匹配的权限组');
      const result = await context.services.administration.createUser({
        name, email, role, permissionGroupId,
      });
      data.notice = result.temporaryPassword
        ? `用户已创建，临时密码：${result.temporaryPassword}`
        : '用户已创建';
    } else if (action === 'edit-user') {
      const existing = data.payload.users.find(user => user.id === userId);
      const name = globalThis.prompt?.('用户名称', existing?.name || '');
      if (!name) return;
      const role = String(globalThis.prompt?.('角色：admin / manager / sales', existing?.role || 'sales') || '').trim();
      if (!['admin', 'manager', 'sales'].includes(role)) throw new Error('角色必须是 admin、manager 或 sales');
      const groups = (data.payload.permissionGroups || []).filter(group => group.role === role);
      const permissionGroupId = String(globalThis.prompt?.(
        `权限组 ID（${groups.map(group => `${group.id}:${group.name}`).join('，')}）`,
        groups.some(group => group.id === existing?.permissionGroupId) ? existing.permissionGroupId : (groups[0]?.id || ''),
      ) || '').trim();
      if (!permissionGroupId) throw new Error('请选择与角色匹配的权限组');
      const active = String(globalThis.prompt?.('是否启用：true / false', existing?.active ? 'true' : 'false') || '').trim() === 'true';
      await context.services.administration.updateUser(userId, {
        name,
        role,
        active,
        permissionGroupId,
        languages: existing?.languages || [],
        countries: existing?.countries || [],
        channels: existing?.channels || [],
      });
    } else if (action === 'permission-overrides') {
      const raw = globalThis.prompt?.('输入权限覆盖 JSON（allow/deny/inherit）', '{}');
      if (!raw) return;
      await context.services.administration.replacePermissionOverrides(userId, JSON.parse(raw));
    } else if (action === 'archive-user') {
      if (!globalThis.confirm?.('确认归档该用户？现有会话将失效。')) return;
      await context.services.administration.archiveUser(userId);
    } else if (action === 'restore-user') {
      await context.services.administration.restoreUser(userId);
    } else if (action === 'delete-user') {
      if (!globalThis.confirm?.('确认永久删除该归档用户？有关联业务数据时服务器会拒绝。')) return;
      await context.services.administration.deleteUser(userId);
    } else if (action === 'reset-password') {
      const password = globalThis.prompt?.('输入新密码');
      if (!password) return;
      const passwordConfirm = globalThis.prompt?.('再次输入新密码');
      if (password !== passwordConfirm) throw new Error('两次输入的新密码不一致');
      await context.services.administration.resetPassword(userId, { password, passwordConfirm });
    } else if (action === 'impersonate') {
      await context.services.session.startImpersonation(userId);
      globalThis.location?.reload?.();
      return;
    } else if (action === 'resolve-review') {
      const ownerId = globalThis.prompt?.('输入目标销售用户 ID');
      if (!ownerId) return;
      await context.services.administration.resolveMigrationReview(element.dataset.reviewId, { ownerId });
    } else if (action === 'create-group') {
      const name = globalThis.prompt?.('权限组名称');
      if (!name) return;
      const role = String(globalThis.prompt?.('角色：admin / manager / sales', 'sales') || '').trim();
      if (!['admin', 'manager', 'sales'].includes(role)) throw new Error('角色必须是 admin、manager 或 sales');
      const description = globalThis.prompt?.('权限组说明', '') || '';
      const raw = globalThis.prompt?.('权限 JSON', JSON.stringify(data.payload.rolePermissions?.[role] || {}));
      if (!raw) return;
      await context.services.administration.createPermissionGroup({
        name, role, description, permissions: JSON.parse(raw),
      });
    } else if (action === 'edit-group') {
      const groupId = element.dataset.groupId;
      const existing = data.payload.permissionGroups.find(group => group.id === groupId);
      const name = globalThis.prompt?.('权限组名称', existing?.name || '');
      if (!name) return;
      const description = globalThis.prompt?.('权限组说明', existing?.description || '') || '';
      const raw = globalThis.prompt?.('权限 JSON', JSON.stringify(existing?.permissions || {}));
      if (!raw) return;
      await context.services.administration.updatePermissionGroup(groupId, {
        name, description, permissions: JSON.parse(raw),
      });
    } else if (action === 'set-assistant-mode') {
      const mode = String(globalThis.prompt?.('路由模式：auto / qwen / kimi-cli / hermes / deepseek', data.runtime?.mode || 'auto') || '').trim();
      if (!mode) return;
      data.runtime = await context.services.administration.updateAssistantRuntime({ mode });
      data.notice = 'AI 路由模式已更新';
      rerender(context, data);
      return;
    } else if (action === 'recheck-runtime') {
      data.runtime = await context.services.administration.recheckAssistantRuntime();
      data.notice = 'AI 引擎状态已重新检测';
      rerender(context, data);
      return;
    } else if (action === 'toggle-ai-feature') {
      const key = element.dataset.featureKey;
      const feature = data.features[key];
      const result = await context.services.ai.updateFeature(key, { enabled: !feature.runtimeEnabled });
      data.features = result.features || data.features;
      data.notice = `${key} 已${feature.runtimeEnabled ? '关闭' : '开启'}`;
      rerender(context, data);
      return;
    } else {
      data.error = '该入口已保留，请在账号详情中完成字段级编辑。';
      rerender(context, data);
      return;
    }
    await refresh(context, data);
  } catch (error) {
    data.error = error?.status === 403 ? '403 当前身份无权执行该操作' : error.message;
    rerender(context, data);
  }
}

export function render(context) {
  current = { context, data: context.data };
  if (context.data.state === 'forbidden') {
    context.mount.innerHTML = renderEmptyState({
      title: '403 系统管理仅限管理员',
      description: '经理日常工作区和模拟身份均不加载管理 DOM。',
    });
    return;
  }
  if (context.data.state === 'error') {
    context.mount.innerHTML = renderEmptyState({ title: '系统管理加载失败', description: context.data.message });
    return;
  }
  rerender(context, context.data);
  context.lifecycle.listen(context.mount, 'click', event => {
    const tab = event.target.closest?.('[data-admin-tab]');
    if (tab) {
      context.data.tab = tab.dataset.adminTab;
      rerender(context, context.data);
      return;
    }
    const action = event.target.closest?.('[data-admin-action]');
    if (action) void adminAction(context, context.data, action.dataset.adminAction, action);
  });
  context.lifecycle.listen(context.mount, 'submit', async event => {
    if (event.target.matches?.('[data-maintenance-preview]')) {
      event.preventDefault();
      const form = new FormData(event.target);
      const list = value => String(value || '').split(/[,，\s]+/).filter(Boolean);
      try {
        context.data.maintenancePreview = await context.services.administration.previewMaintenance({
          operation: 'reset_assignments',
          filters: {
            batchIds: list(form.get('batchId')),
            ownerIds: list(form.get('ownerId')),
            intakeItemIds: list(form.get('itemIds')),
            allAssigned: form.get('allAssigned') === 'on',
          },
        });
      } catch (error) {
        context.data.error = error?.status === 403 ? '403 无权预览数据维护' : error.message;
      }
      rerender(context, context.data);
    } else if (event.target.matches?.('[data-maintenance-execute]')) {
      event.preventDefault();
      try {
        const confirmationText = String(new FormData(event.target).get('confirmationText') || '');
        await context.services.administration.executeMaintenance({
          previewId: context.data.maintenancePreview.previewId,
          confirmationText,
        }, { timeoutMs: 120000 });
        context.data.maintenancePreview = null;
        const runs = await context.services.administration.maintenanceRuns({ limit: 20 });
        context.data.maintenanceRuns = runs.runs || [];
      } catch (error) {
        context.data.error = error?.status === 403 ? '403 无权执行数据维护' : error.message;
      }
      rerender(context, context.data);
    }
  });
}

export function dispose() {
  current = null;
}
