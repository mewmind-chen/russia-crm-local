export function createLifecycleScope() {
  const timeouts = new Set();
  const intervals = new Set();
  const controllers = new Set();
  const cleanups = new Set();
  const rootController = new AbortController();
  let disposed = false;

  function addCleanup(cleanup) {
    if (typeof cleanup !== 'function') {
      throw new TypeError('lifecycle cleanup must be a function');
    }
    if (disposed) {
      cleanup();
      return () => {};
    }
    cleanups.add(cleanup);
    return () => cleanups.delete(cleanup);
  }

  function listen(target, type, listener, options) {
    if (!target || typeof target.addEventListener !== 'function') {
      throw new TypeError('lifecycle event target must support addEventListener');
    }
    if (disposed) return () => {};
    target.addEventListener(type, listener, options);
    const cleanup = () => target.removeEventListener(type, listener, options);
    const untrack = addCleanup(cleanup);
    return () => {
      cleanup();
      untrack();
    };
  }

  function timeout(callback, delay, ...args) {
    if (disposed) return null;
    const id = setTimeout(() => {
      timeouts.delete(id);
      callback(...args);
    }, delay);
    timeouts.add(id);
    return id;
  }

  function interval(callback, delay, ...args) {
    if (disposed) return null;
    const id = setInterval(callback, delay, ...args);
    intervals.add(id);
    return id;
  }

  function createAbortController() {
    const controller = new AbortController();
    if (disposed) {
      controller.abort();
      return controller;
    }
    controllers.add(controller);
    controller.signal.addEventListener('abort', () => controllers.delete(controller), { once: true });
    return controller;
  }

  function trackAbortController(controller) {
    if (!controller || typeof controller.abort !== 'function' || !controller.signal) {
      throw new TypeError('expected an AbortController');
    }
    if (disposed) controller.abort();
    else {
      controllers.add(controller);
      controller.signal.addEventListener('abort', () => controllers.delete(controller), { once: true });
    }
    return controller;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    rootController.abort();
    for (const id of timeouts) clearTimeout(id);
    for (const id of intervals) clearInterval(id);
    for (const controller of controllers) controller.abort();
    for (const cleanup of [...cleanups]) cleanup();
    timeouts.clear();
    intervals.clear();
    controllers.clear();
    cleanups.clear();
  }

  return {
    get disposed() { return disposed; },
    signal: rootController.signal,
    listen,
    on: listen,
    timeout,
    setTimeout: timeout,
    interval,
    setInterval: interval,
    createAbortController,
    trackAbortController,
    addCleanup,
    dispose,
  };
}
