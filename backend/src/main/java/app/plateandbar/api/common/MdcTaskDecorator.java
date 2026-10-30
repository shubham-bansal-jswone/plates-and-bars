package app.plateandbar.api.common;

import java.util.Map;
import org.slf4j.MDC;
import org.springframework.core.task.TaskDecorator;
import org.springframework.stereotype.Component;

/**
 * Carries the caller's MDC (the {@code requestId} that {@link RequestIdFilter} sets) onto an async worker thread, so log
 * lines written while {@code GET /me/export} streams are tagged. Spring Boot applies a single {@link TaskDecorator} bean
 * to the auto-configured {@code applicationTaskExecutor}, which MVC uses for async bodies. The worker's own context is
 * restored afterwards, so an id never leaks into the next task. It logs nothing and copies only what is in the MDC.
 */
@Component
public class MdcTaskDecorator implements TaskDecorator {

    @Override
    public Runnable decorate(Runnable task) {
        Map<String, String> caller = MDC.getCopyOfContextMap(); // taken on the submitting thread
        return () -> {
            Map<String, String> before = MDC.getCopyOfContextMap();
            if (caller == null) MDC.clear();
            else MDC.setContextMap(caller);
            try {
                task.run();
            } finally {
                if (before == null) MDC.clear();
                else MDC.setContextMap(before);
            }
        };
    }
}
