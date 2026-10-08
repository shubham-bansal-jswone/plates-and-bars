package app.plateandbar.api.ratelimit;

import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Client address for rate limiting. By default it is the socket peer ({@code getRemoteAddr}) and
 * X-Forwarded-For is ignored, so a client cannot choose its own bucket. Only when the peer is a configured
 * trusted proxy is the header read, and then from the right: the first hop that is not itself a trusted proxy
 * is the client. Anything the client prepends sits to the left of that hop and is never reached. A malformed
 * header falls back to the peer. IPv6 clients are keyed by their /64, since a single host owns that range.
 */
public class ClientIpResolver {

    private static final Pattern LITERAL = Pattern.compile("[0-9a-fA-F:.]+");

    private record Cidr(byte[] network, int prefixBits) {
        boolean contains(byte[] addr) {
            if (addr.length != network.length) {
                return false;
            }
            int full = prefixBits / 8;
            for (int i = 0; i < full; i++) {
                if (addr[i] != network[i]) {
                    return false;
                }
            }
            int rest = prefixBits % 8;
            if (rest == 0) {
                return true;
            }
            int mask = 0xFF << (8 - rest);
            return (addr[full] & mask) == (network[full] & mask);
        }
    }

    private final List<Cidr> trusted = new ArrayList<>();

    public ClientIpResolver(List<String> trustedProxies) {
        for (String entry : trustedProxies) {
            trusted.add(parseCidr(entry.trim()));
        }
    }

    public String resolve(HttpServletRequest request) {
        String peer = request.getRemoteAddr();
        InetAddress peerAddr = parseLiteral(peer);
        if (peerAddr == null) {
            return peer == null ? "unknown" : peer;
        }
        if (!isTrusted(peerAddr)) {
            return key(peerAddr);
        }
        List<String> hops = new ArrayList<>();
        var headers = request.getHeaders("X-Forwarded-For");
        while (headers != null && headers.hasMoreElements()) {
            for (String h : headers.nextElement().split(",")) {
                hops.add(h.trim());
            }
        }
        for (int i = hops.size() - 1; i >= 0; i--) {
            InetAddress hop = parseLiteral(hops.get(i));
            if (hop == null) {
                return key(peerAddr);
            }
            if (!isTrusted(hop)) {
                return key(hop);
            }
        }
        return key(peerAddr);
    }

    private boolean isTrusted(InetAddress addr) {
        byte[] bytes = addr.getAddress();
        return trusted.stream().anyMatch(c -> c.contains(bytes));
    }

    private static String key(InetAddress addr) {
        byte[] b = addr.getAddress();
        if (b.length == 16) {
            for (int i = 8; i < 16; i++) {
                b[i] = 0;
            }
            try {
                return InetAddress.getByAddress(b).getHostAddress() + "/64";
            } catch (UnknownHostException e) {
                throw new IllegalStateException(e);
            }
        }
        return addr.getHostAddress();
    }

    private static final Pattern IPV4 = Pattern.compile("(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})");

    /**
     * Parses IP literals only and returns null for anything else, never resolving a name. IPv4 is parsed by hand
     * (four decimal octets), so {@code dead.beef.cafe} is rejected and nothing reaches DNS. IPv6 must contain a
     * colon, which makes {@code InetAddress.getByName} parse it as a literal; a hop with a port ({@code 1.2.3.4:80})
     * is therefore not an IPv4 literal and is rejected too.
     */
    static InetAddress parseLiteral(String s) {
        if (s == null || s.isEmpty() || s.length() > 45) {
            return null;
        }
        try {
            var m = IPV4.matcher(s);
            if (m.matches()) {
                byte[] b = new byte[4];
                for (int i = 0; i < 4; i++) {
                    int v = Integer.parseInt(m.group(i + 1));
                    if (v > 255) {
                        return null;
                    }
                    b[i] = (byte) v;
                }
                return InetAddress.getByAddress(b);
            }
            if (s.indexOf(':') < 0 || !LITERAL.matcher(s).matches()) {
                return null;
            }
            return InetAddress.getByName(s);
        } catch (UnknownHostException | NumberFormatException e) {
            return null;
        }
    }

    private static Cidr parseCidr(String entry) {
        String[] parts = entry.split("/", 2);
        InetAddress addr = parseLiteral(parts[0]);
        if (addr == null) {
            throw new IllegalArgumentException("app.rate-limit.trusted-proxies: not an IP or CIDR range");
        }
        byte[] bytes = addr.getAddress();
        int bits = parts.length == 2 ? Integer.parseInt(parts[1]) : bytes.length * 8;
        if (bits < 0 || bits > bytes.length * 8) {
            throw new IllegalArgumentException("app.rate-limit.trusted-proxies: bad prefix length");
        }
        return new Cidr(bytes, bits);
    }
}
