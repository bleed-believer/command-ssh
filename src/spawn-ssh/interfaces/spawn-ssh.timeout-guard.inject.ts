export interface SpawnSSHTimeoutGuardInject {
    /**
     * Schedules the expiry and hands back the way to call it off.
     *
     * The pair travels together on purpose. Injecting `setTimeout` and
     * `clearTimeout` separately would force the type of the handle between
     * them into this interface, and that handle is `NodeJS.Timeout` for the
     * real timers and whatever a double feels like for the tests. A closure
     * carries it instead, and neither side has to name it.
     */
    schedule?: (callback: () => void, ms: number) => () => void;
}
