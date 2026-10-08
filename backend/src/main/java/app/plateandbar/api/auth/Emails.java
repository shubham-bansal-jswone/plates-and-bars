package app.plateandbar.api.auth;

import java.util.Locale;

/** ADR 004: "same address" means trimmed and lower-cased, nothing more. */
final class Emails {
    private Emails() {}

    static String normalise(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
