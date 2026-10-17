package app.plateandbar.api.account;

/** The erasure ledger could not be written. DELETE /me then deletes nothing and answers 500. Never carries a path or id. */
public class ErasureLedgerException extends RuntimeException {
    ErasureLedgerException(String message, Throwable cause) {
        super(message, cause);
    }
}
