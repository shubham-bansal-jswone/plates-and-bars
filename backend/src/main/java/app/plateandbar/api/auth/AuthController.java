package app.plateandbar.api.auth;

import app.plateandbar.api.auth.AuthDtos.*;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    @PostMapping("/google")
    public TokenPair google(@Valid @RequestBody GoogleSignInRequest req) {
        return auth.signInWithGoogle(req.idToken());
    }

    @PostMapping("/email/start")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public EmailStartResponse emailStart(@Valid @RequestBody EmailStartRequest req) {
        return auth.startEmailSignIn(req.email());
    }

    @PostMapping("/email/verify")
    public TokenPair emailVerify(@Valid @RequestBody EmailVerifyRequest req) {
        return auth.verifyEmailSignIn(req.email(), req.code());
    }

    @PostMapping("/refresh")
    public TokenPair refresh(@Valid @RequestBody RefreshRequest req) {
        return auth.refresh(req.refreshToken());
    }
}
