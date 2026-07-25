export function createStore(initialState = {}) {
  if (!initialState || typeof initialState !== 'object' || Array.isArray(initialState)) {
    throw new TypeError('initialState must be an object');
  }

  const state = { ...initialState };
  const subscribers = new Map();

  function getSubscribers(section) {
    if (!subscribers.has(section)) subscribers.set(section, new Set());
    return subscribers.get(section);
  }

  function notify(section, value, previous) {
    for (const listener of [...(subscribers.get(section) || [])]) {
      listener(value, previous, state);
    }
    for (const listener of [...(subscribers.get('*') || [])]) {
      listener(state, { section, value, previous });
    }
  }

  function setSection(section, nextValue) {
    const previous = state[section];
    const value = typeof nextValue === 'function'
      ? nextValue(previous, state)
      : nextValue;
    if (Object.is(previous, value)) return value;
    state[section] = value;
    notify(section, value, previous);
    return value;
  }

  function setState(update) {
    const patch = typeof update === 'function' ? update(state) : update;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new TypeError('state update must return an object');
    }
    for (const [section, value] of Object.entries(patch)) {
      setSection(section, value);
    }
    return state;
  }

  function subscribe(section, listener) {
    if (typeof section === 'function') {
      listener = section;
      section = '*';
    }
    if (typeof listener !== 'function') {
      throw new TypeError('store listener must be a function');
    }
    const listeners = getSubscribers(section);
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  return {
    state,
    getState: () => state,
    setState,
    setSection,
    subscribe,
  };
}
