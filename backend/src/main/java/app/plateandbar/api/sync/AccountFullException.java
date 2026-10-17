package app.plateandbar.api.sync;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse.RecordCap;
import org.springframework.http.HttpStatus;

/** 413 {@code account_full}: the push has new records and stored + new is over the per-account cap. */
public class AccountFullException extends ApiException {
    private final RecordCap recordCap;

    public AccountFullException(long limit, long stored, long newRecords) {
        super(HttpStatus.CONTENT_TOO_LARGE, "account_full",
                "Your account is full. New entries stay on this device and are not backed up.");
        this.recordCap = new RecordCap(limit, stored, newRecords);
    }

    public RecordCap recordCap() {
        return recordCap;
    }
}
