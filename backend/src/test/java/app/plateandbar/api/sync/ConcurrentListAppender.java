package app.plateandbar.api.sync;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.util.concurrent.CopyOnWriteArrayList;

/** ListAppender whose list can be iterated while server threads are still appending (ListAppender uses an ArrayList). */
final class ConcurrentListAppender extends ListAppender<ILoggingEvent> {
    ConcurrentListAppender() {
        list = new CopyOnWriteArrayList<>();
    }
}
