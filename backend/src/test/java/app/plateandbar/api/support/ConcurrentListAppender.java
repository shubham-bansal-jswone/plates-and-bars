package app.plateandbar.api.support;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.util.concurrent.CopyOnWriteArrayList;

/** ListAppender whose list can be iterated while server threads are still appending (ListAppender uses an ArrayList). */
public final class ConcurrentListAppender extends ListAppender<ILoggingEvent> {
    public ConcurrentListAppender() {
        list = new CopyOnWriteArrayList<>();
    }
}
