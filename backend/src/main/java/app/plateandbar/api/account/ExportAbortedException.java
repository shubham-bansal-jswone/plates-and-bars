package app.plateandbar.api.account;

/**
 * Thrown out of the export stream when it fails. Fixed message and no cause, because the container logs the thrown
 * exception when it aborts the connection and the original message could quote a row.
 */
final class ExportAbortedException extends RuntimeException {
    ExportAbortedException() {
        super("export aborted", null, false, false);
    }
}
