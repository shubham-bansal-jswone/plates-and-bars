package app.plateandbar.api.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class ClientIpResolverTest {

    private static MockHttpServletRequest req(String peer, String... xff) {
        MockHttpServletRequest r = new MockHttpServletRequest();
        r.setRemoteAddr(peer);
        for (String h : xff) {
            r.addHeader("X-Forwarded-For", h);
        }
        return r;
    }

    @Test
    void defaultsToTheSocketPeerAndIgnoresForwardedFor() {
        ClientIpResolver r = new ClientIpResolver(List.of());
        assertThat(r.resolve(req("203.0.113.9", "198.51.100.1"))).isEqualTo("203.0.113.9");
    }

    @Test
    void forwardedForFromAnUntrustedPeerCannotChooseTheBucket() {
        ClientIpResolver r = new ClientIpResolver(List.of("10.0.0.0/8"));
        assertThat(r.resolve(req("203.0.113.9", "10.1.1.1"))).isEqualTo("203.0.113.9");
    }

    @Test
    void trustedProxyYieldsTheRightmostUntrustedHop() {
        ClientIpResolver r = new ClientIpResolver(List.of("10.0.0.0/8", "192.168.1.1"));
        // The client prepended 1.1.1.1; the proxy appended the address it really saw.
        assertThat(r.resolve(req("10.0.0.5", "1.1.1.1, 198.51.100.7, 10.0.0.9"))).isEqualTo("198.51.100.7");
        assertThat(r.resolve(req("192.168.1.1", "198.51.100.7"))).isEqualTo("198.51.100.7");
        // Header split over several lines is the same list.
        assertThat(r.resolve(req("10.0.0.5", "1.1.1.1", "198.51.100.7"))).isEqualTo("198.51.100.7");
    }

    @Test
    void trustedProxyWithoutOrWithMalformedHeaderFallsBackToThePeer() {
        ClientIpResolver r = new ClientIpResolver(List.of("10.0.0.0/8"));
        assertThat(r.resolve(req("10.0.0.5"))).isEqualTo("10.0.0.5");
        assertThat(r.resolve(req("10.0.0.5", "198.51.100.7, not-an-ip"))).isEqualTo("10.0.0.5");
        assertThat(r.resolve(req("10.0.0.5", "localhost"))).isEqualTo("10.0.0.5");
        assertThat(r.resolve(req("10.0.0.5", "10.0.0.7"))).isEqualTo("10.0.0.5");
        // A hop with a port is not an IP literal, so the peer is used.
        assertThat(r.resolve(req("10.0.0.5", "198.51.100.7:4711"))).isEqualTo("10.0.0.5");
    }

    @Test
    void onlyStrictIpLiteralsAreParsedAndNamesAreNeverResolved() {
        // Hex-looking names such as dead.beef.cafe are hostnames, not addresses: rejected before any lookup.
        for (String s : new String[] {"dead.beef.cafe", "localhost", "1.2.3", "256.1.1.1", "1.2.3.4.5", "1.2.3.4:80", "a.b", "", "1.2.3.4%eth0", "example.com"}) {
            assertThat(ClientIpResolver.parseLiteral(s)).as(s).isNull();
        }
        assertThat(ClientIpResolver.parseLiteral("198.51.100.7")).isNotNull();
        assertThat(ClientIpResolver.parseLiteral("2001:db8::1")).isNotNull();
        assertThat(ClientIpResolver.parseLiteral("::ffff:1.2.3.4")).isNotNull();
        ClientIpResolver r = new ClientIpResolver(List.of("10.0.0.0/8"));
        assertThat(r.resolve(req("10.0.0.5", "dead.beef.cafe"))).isEqualTo("10.0.0.5");
    }

    @Test
    void ipv6ClientsShareABucketPerSlash64() {
        ClientIpResolver r = new ClientIpResolver(List.of());
        String a = r.resolve(req("2001:db8:1:2:aaaa:bbbb:cccc:dddd"));
        String b = r.resolve(req("2001:db8:1:2:1111:2222:3333:4444"));
        String c = r.resolve(req("2001:db8:1:3::1"));
        assertThat(a).isEqualTo(b).isNotEqualTo(c);
    }

    @Test
    void badTrustedProxyConfigurationFailsFast() {
        assertThatThrownBy(() -> new ClientIpResolver(List.of("proxy.internal"))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ClientIpResolver(List.of("10.0.0.0/40"))).isInstanceOf(IllegalArgumentException.class);
    }
}
