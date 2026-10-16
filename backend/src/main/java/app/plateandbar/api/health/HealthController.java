package app.plateandbar.api.health;

import app.plateandbar.api.common.ServiceUnavailableException;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    private final JdbcTemplate jdbc;

    public HealthController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/api/v1/health")
    public HealthResponse health() {
        try {
            jdbc.queryForObject("SELECT 1", Integer.class);
        } catch (DataAccessException e) {
            throw new ServiceUnavailableException(e);
        }
        return new HealthResponse("ok");
    }
}
