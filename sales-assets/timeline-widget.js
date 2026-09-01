(function initTradePulseTimelineWidget(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradePulseTimelineWidget = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  // —— CRM 抽屉时间线列表 widget（自包含模板/转义）——
  // 线索抽屉（开发历史）与回收抽屉（完整时间线）共用同一 `.timeline` 列表渲染：
  // 每条目为 timeline-item（h4 标题 + 可选摘要/下一步 + time 执行人与日期）。
  // 对外只暴露 renderItemsHtml(events, ctx)（纯函数，便于契约测试）与
  // render(container, events, ctx)。
  // ctx 说明（均为可选，缺省回退到 event 同名字段）：
  //   titleOf      event => 标题文本（如 timelineEventTitle）
  //   summaryOf    event => 摘要文本（如 timelineEventSummary）
  //   actorOf      event => 执行人文本
  //   dateOf       event => 日期文本（如 shortDate(...)）
  //   nextActionOf event => 下一步动作文本（缺省空则不渲染"下一步"行）
  //   emptyText    空列表文案（如 暂无开发历史）
  // 所有文本在 widget 内统一转义，事件字段缺省回退到同名字段或空串。

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[character]);
  }

  function defaultOf(name, value) {
    return value === undefined ? '' : value;
  }

  function renderItemsHtml(events = [], ctx = {}) {
    const list = Array.isArray(events) ? events : [];
    if (!list.length) {
      return `<div class="empty">${escapeHtml(ctx.emptyText || '')}</div>`;
    }
    const titleOf = ctx.titleOf || (event => event?.title);
    const summaryOf = ctx.summaryOf || (event => event?.summary);
    const actorOf = ctx.actorOf || (event => event?.actor_name || event?.actorName);
    const dateOf = ctx.dateOf || (event => event?.occurred_at || event?.occurredAt);
    const nextActionOf = ctx.nextActionOf || (() => '');
    return list.map(event => {
      const title = defaultOf('title', titleOf(event));
      const summary = defaultOf('summary', summaryOf(event));
      const actor = defaultOf('actor', actorOf(event));
      const date = defaultOf('date', dateOf(event));
      const nextAction = defaultOf('nextAction', nextActionOf(event));
      const nextLine = nextAction ? `<br><strong>下一步：</strong>${escapeHtml(nextAction)}` : '';
      const summaryHtml = summary ? `<p>${escapeHtml(summary)}${nextLine}</p>` : '';
      return `<div class="timeline-item"><h4>${escapeHtml(title)}</h4>${summaryHtml}<time>${escapeHtml(actor)}${actor ? ' · ' : ''}${escapeHtml(date)}</time></div>`;
    }).join('');
  }

  // CRM 活动时间线条目（含更正入口）使用显式回调注入业务状态。
  // widget 不读取宿主 state，也不自行请求 counterpart/customer 数据，避免把
  // 权限边界或 AI/业务状态带入通用模板。宿主只需提供：
  // titleOf/summaryOf/actorOf/dateOf/activityIdOf、correctionOf，以及 provenanceOf。
  function renderActivityItemHtml(event = {}, ctx = {}) {
    const item = event || {};
    const titleOf = ctx.titleOf || (row => row?.title);
    const summaryOf = ctx.summaryOf || (row => row?.summary);
    const actorOf = ctx.actorOf || (row => row?.actor_name || row?.actorName);
    const dateOf = ctx.dateOf || (row => row?.occurred_at || row?.occurredAt);
    const activityIdOf = ctx.activityIdOf || (row => row?.activity_id
      || (String(row?.id || '').startsWith('activity:') ? String(row.id).slice(9) : ''));
    const provenanceOf = typeof ctx.provenanceOf === 'function' ? ctx.provenanceOf : (() => ({}));
    const correctionOf = typeof ctx.correctionOf === 'function'
      ? ctx.correctionOf
      : row => ({
        activityId: activityIdOf(row),
        enabled: typeof ctx.canCorrect === 'function' && ctx.canCorrect(row),
        writeReady: ctx.correctionWriteReady === true,
        disabledTitle: ctx.correctionDisabledTitle || '',
      });
    const provenance = provenanceOf(item) || {};
    const superseded = typeof ctx.supersededOf === 'function'
      ? Boolean(ctx.supersededOf(item)) : Boolean(item.superseded);
    const title = titleOf(item) ?? '';
    const summary = summaryOf(item) ?? '';
    const actor = actorOf(item) ?? '';
    const date = dateOf(item) ?? '';
    const correction = correctionOf(item) || {};
    const activityId = correction.activityId ?? activityIdOf(item) ?? '';
    const correctionEntry = correction.enabled === true
      ? `<button class="text-button activity-correction-entry" type="button" data-correct-activity="${escapeHtml(activityId)}" ${correction.writeReady === true ? '' : `disabled aria-disabled="true" title="${escapeHtml(correction.disabledTitle || correction.disabledReason || '')}"`}>${escapeHtml(correction.label || ctx.correctionLabel || '更正归属客户')}</button>`
      : '';
    let provenanceMarkup = '';
    const provenanceState = provenance.state || provenance.kind || '';
    if (provenanceState === 'superseded_original' || provenanceState === 'superseded' || superseded) {
      const target = provenance.replacementLabel
        ? `目标客户：${escapeHtml(provenance.replacementLabel)}` : '目标记录信息受权限保护';
      provenanceMarkup = `<span class="activity-correction-provenance superseded">已更正 · ${target}</span>`;
    } else if (provenanceState === 'replacement') {
      const source = provenance.originalLabel
        ? `来源客户：${escapeHtml(provenance.originalLabel)}` : '受保护的来源记录';
      provenanceMarkup = `<span class="activity-correction-provenance replacement">更正自${source} · 当前记录有效</span>`;
    }
    const nextAction = typeof ctx.nextActionOf === 'function'
      ? ctx.nextActionOf(item) : (item.no_plan ? '暂无计划'
        : (item.next_action && item.next_action !== summary ? item.next_action : ''));
    const nextLine = nextAction ? `<br><strong>下一步：</strong>${escapeHtml(nextAction)}` : '';
    const summaryHtml = summary ? `<p>${escapeHtml(summary)}${nextLine}</p>` : '';
    const timelineKind = typeof ctx.timelineKindOf === 'function' ? ctx.timelineKindOf(item) : item.kind || 'activity';
    return `<div class="timeline-item ${superseded ? 'is-superseded' : ''}" data-timeline-kind="${escapeHtml(timelineKind)}">
      <div class="activity-correction-timeline-head"><h4>${escapeHtml(title)}</h4>${correctionEntry}</div>
      ${summaryHtml}${provenanceMarkup}<time>${escapeHtml(actor)}${actor ? ' · ' : ''}${escapeHtml(date)}</time></div>`;
  }

  function renderActivityItemsHtml(events = [], ctx = {}) {
    const list = Array.isArray(events) ? events : [];
    if (!list.length) return `<div class="empty">${escapeHtml(ctx.emptyText || '')}</div>`;
    return list.map(event => renderActivityItemHtml(event, ctx)).join('');
  }

  function render(container, events = [], ctx = {}) {
    if (!container) return;
    container.innerHTML = renderItemsHtml(events, ctx);
  }

  // —— CRM 抽屉完整客户时间线区块壳（panel-head 风格）——
  // ctx：{ eyebrow, title, note, actionHtml, bodyClass, bodyHtml }，
  // eyebrow/title/note 内部转义，actionHtml/bodyHtml 为宿主安全 HTML。
  function renderSectionHtml(ctx = {}) {
    const note = ctx.note ? `<span class="panel-note">${escapeHtml(ctx.note)}</span>` : '';
    const title = escapeHtml(ctx.title || '');
    const eyebrow = ctx.eyebrow ? `<p class="eyebrow">${escapeHtml(ctx.eyebrow)}</p>` : '';
    const bodyClass = ctx.bodyClass || 'timeline';
    return `<div><div class="panel-head" style="padding-left:0;padding-right:0"><div>${eyebrow}<h2>${title}</h2></div>${note}${ctx.actionHtml || ''}</div>
      <div class="${escapeHtml(bodyClass)}">${ctx.bodyHtml === undefined ? '' : ctx.bodyHtml}</div></div>`;
  }

  return Object.freeze({
    escapeHtml,
    renderItemsHtml,
    renderActivityItemHtml,
    renderActivityItemsHtml,
    renderSectionHtml,
    render,
  });
}));
