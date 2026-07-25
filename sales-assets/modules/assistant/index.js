import { escapeAttribute, escapeHtml } from '../../components/html.js';
import { renderEmptyState } from '../../components/empty-state.js';

export const id = 'assistant';

let current = null;

function scopeLabel(scope = {}) {
  if (scope.customerId) return `客户 · ${scope.companyName || scope.customerId}`;
  if (scope.intakeItemId) return `线索 · ${scope.companyName || scope.intakeItemId}`;
  if (scope.teamUserId) return `团队成员 · ${scope.teamUserName || scope.teamUserId}`;
  return '当前工作区';
}

function scopeFromForm(form) {
  const type = String(new FormData(form).get('scopeType') || 'workspace');
  const reference = String(new FormData(form).get('scopeReference') || '').trim();
  if (type === 'customer') return { scopeType: type, customerId: reference };
  if (type === 'intake') return { scopeType: type, intakeItemId: reference };
  if (type === 'team') return { scopeType: type, teamUserId: reference };
  return { scopeType: 'workspace' };
}

function clientMessageId() {
  return globalThis.crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function load(context) {
  context.mount.innerHTML = '<div class="empty-state" role="status"><strong>正在加载并恢复 AI 助手历史…</strong></div>';
  if (!context.access.permissions?.use_ai_assistant) return { state: 'forbidden' };
  try {
    const controller = context.lifecycle.createAbortController();
    const payload = await context.services.ai.conversations({}, {
      signal: controller.signal,
      timeoutMs: 12000,
    });
    return {
      state: 'ready',
      conversations: payload.conversations || [],
      conversation: null,
      selectedId: '',
      scope: { scopeType: 'workspace' },
      sending: false,
      error: '',
    };
  } catch (error) {
    return {
      state: error?.status === 403 ? 'forbidden' : 'error',
      message: error?.message || '无法恢复助手历史',
    };
  }
}

function conversations(data) {
  if (!data.conversations.length) return renderEmptyState({
    title: '暂无历史会话',
    description: '选择明确范围后开始第一条对话。',
  });
  return `<div class="assistant-conversation-list">${data.conversations.map(item =>
    `<button type="button" data-conversation-id="${escapeAttribute(item.id)}" aria-current="${data.selectedId === item.id ? 'true' : 'false'}">
      <strong>${escapeHtml(item.favorite ? `★ ${item.title}` : item.title || '新对话')}</strong>
      <small>${escapeHtml(scopeLabel(item.scope))} · ${Number(item.messageCount || 0)} 条</small>
    </button>`).join('')}</div>`;
}

function messages(data) {
  if (!data.conversation) return renderEmptyState({
    title: '选择历史会话或直接提问',
    description: `当前请求范围：${scopeLabel(data.scope)}`,
  });
  const rows = data.conversation.messages || [];
  if (!rows.length) return renderEmptyState({
    title: '该会话暂无消息',
    description: `会话范围：${scopeLabel(data.conversation.scope || data.scope)}`,
  });
  return `<div class="assistant-message-list">${rows.map(message =>
    `<article class="assistant-message ${escapeAttribute(message.role || '')}">
      <strong>${message.role === 'user' ? '我' : 'AI 助手'}</strong>
      <p>${escapeHtml(message.content || '')}</p>
    </article>`).join('')}</div>`;
}

function content(data) {
  const visibleScope = data.conversation?.scope || data.scope;
  return `<div class="module-workspace assistant-workspace" data-module="${id}">
    <header class="workspace-header"><div><p class="eyebrow">ASSISTANT</p><h1>AI 助手 · ${escapeHtml(scopeLabel(visibleScope))}</h1>
      <p>标题和每次请求都显示并携带明确 scope。</p></div>
      <button class="button secondary" type="button" data-new-conversation>新对话</button>
    </header>
    <div class="assistant-layout">
      <aside aria-label="会话历史">${conversations(data)}</aside>
      <section class="assistant-main">
        <form class="workspace-toolbar" data-scope-form>
          <label>范围<select name="scopeType">
            <option value="workspace" ${data.scope.scopeType === 'workspace' ? 'selected' : ''}>当前工作区</option>
            <option value="customer" ${data.scope.scopeType === 'customer' ? 'selected' : ''}>客户</option>
            <option value="intake" ${data.scope.scopeType === 'intake' ? 'selected' : ''}>线索</option>
            <option value="team" ${data.scope.scopeType === 'team' ? 'selected' : ''}>团队成员</option>
          </select></label>
          <label>范围 ID<input name="scopeReference" value="${escapeAttribute(data.scope.customerId || data.scope.intakeItemId || data.scope.teamUserId || '')}" placeholder="工作区范围可留空"></label>
          <button class="button secondary">应用范围</button>
        </form>
        <div class="assistant-scope-banner"><strong>本次请求范围：</strong>${escapeHtml(scopeLabel(visibleScope))}</div>
        ${data.error ? `<div class="status-banner error" role="alert">${escapeHtml(data.error)}</div>` : ''}
        ${messages(data)}
        <form data-assistant-chat>
          <textarea name="message" rows="3" required placeholder="围绕当前范围提问"></textarea>
          <button class="button primary" ${data.sending ? 'disabled' : ''}>${data.sending ? '正在发送…' : '发送'}</button>
        </form>
      </section>
    </div>
  </div>`;
}

function rerender(context, data) {
  if (!context.lifecycle.disposed) context.mount.innerHTML = content(data);
}

async function openConversation(context, data, conversationId) {
  data.error = '';
  try {
    const payload = await context.services.ai.conversation(conversationId, {
      signal: context.lifecycle.signal,
      timeoutMs: 12000,
    });
    data.conversation = payload.conversation;
    data.selectedId = conversationId;
    data.scope = payload.conversation?.scope || { scopeType: 'workspace' };
  } catch (error) {
    data.error = error?.status === 403 ? '403 无权查看该会话' : error.message;
  }
  rerender(context, data);
}

async function send(context, data, message) {
  data.sending = true;
  data.error = '';
  rerender(context, data);
  try {
    const payload = await context.services.ai.chat({
      message,
      conversationId: data.selectedId,
      clientMessageId: clientMessageId(),
      context: data.scope,
    }, { signal: context.lifecycle.signal, timeoutMs: 60000 });
    data.selectedId = payload.conversationId || data.selectedId;
    const [detail, history] = await Promise.all([
      context.services.ai.conversation(data.selectedId, { signal: context.lifecycle.signal }),
      context.services.ai.conversations({}, { signal: context.lifecycle.signal }),
    ]);
    data.conversation = detail.conversation;
    data.conversations = history.conversations || data.conversations;
  } catch (error) {
    data.error = error?.status === 403 ? '403 当前身份不能写入该会话' : (error.message || '发送失败');
  } finally {
    data.sending = false;
    rerender(context, data);
  }
}

export function render(context) {
  current = { context, data: context.data };
  if (context.data.state === 'forbidden') {
    context.mount.innerHTML = renderEmptyState({ title: '403 无权使用 AI 助手', description: '需要 AI 助手权限。' });
    return;
  }
  if (context.data.state === 'error') {
    context.mount.innerHTML = renderEmptyState({ title: '助手历史加载失败', description: context.data.message });
    return;
  }
  rerender(context, context.data);
  context.lifecycle.listen(context.mount, 'click', event => {
    const selected = event.target.closest?.('[data-conversation-id]');
    if (selected) void openConversation(context, context.data, selected.dataset.conversationId);
    if (event.target.closest?.('[data-new-conversation]')) {
      Object.assign(context.data, {
        selectedId: '',
        conversation: null,
        scope: { scopeType: 'workspace' },
        error: '',
      });
      rerender(context, context.data);
    }
  });
  context.lifecycle.listen(context.mount, 'submit', event => {
    if (event.target.matches?.('[data-scope-form]')) {
      event.preventDefault();
      context.data.scope = scopeFromForm(event.target);
      context.data.selectedId = '';
      context.data.conversation = null;
      rerender(context, context.data);
    } else if (event.target.matches?.('[data-assistant-chat]')) {
      event.preventDefault();
      const message = String(new FormData(event.target).get('message') || '').trim();
      if (message) void send(context, context.data, message);
    }
  });
}

export function dispose() {
  current = null;
}
