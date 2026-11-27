/**
 * Single-flight coordination for the Google guest synchronization.
 *
 * The upstream fetch and the database upsert form one logical operation. While
 * that operation is running, every additional caller joins the running
 * operation instead of starting a second upstream request and a second
 * upsert. The first caller and the waiting callers all observe the same
 * result, so concurrent requests never duplicate work or writes.
 *
 * A failed operation releases the slot, so the next request starts a fresh
 * attempt instead of replaying the cached failure.
 */
class GuestSyncCoordinator {
  constructor() {
    this.inFlight = null;
  }

  get isRunning() {
    return this.inFlight !== null;
  }

  /**
   * Runs `task` exclusively and returns the shared operation promise.
   *
   * @param {() => Promise<unknown>} task The upstream fetch and database work.
   * @returns {Promise<unknown>} The result of the single active operation.
   */
  run(task) {
    if (this.inFlight) {
      return this.inFlight;
    }

    // The task starts in a microtask, so the slot is already reserved when
    // the current request handler yields.
    const operation = Promise.resolve().then(task);
    this.inFlight = operation;

    const release = () => {
      if (this.inFlight === operation) {
        this.inFlight = null;
      }
    };

    // `then` with both handlers keeps a rejected operation from producing an
    // unhandled rejection while still releasing the slot.
    operation.then(release, release);

    return operation;
  }
}

module.exports = {
  guestSyncCoordinator: new GuestSyncCoordinator(),
  GuestSyncCoordinator,
};
