package app.plateandbar.api.support;

import app.plateandbar.api.auth.UserExistenceCheck;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;

/** WebMvc slices have no database: every token's user exists unless a test mocks {@link UserExistenceCheck}. */
@TestConfiguration
public class EveryUserExists {
    @Bean
    UserExistenceCheck userExistenceCheck() {
        return new UserExistenceCheck(null) {
            @Override
            public boolean exists(String userId) {
                return true;
            }
        };
    }
}
