package com.aqin.mynotes.lab.l05ssrf;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Locale;
import java.util.Set;

/**
 * Lab 05 - decides whether a user-supplied URL may be fetched by the server.
 * <p>
 * Allowlist the shape of the URL, then check where the host <em>actually resolves to</em>:
 * string checks on the host name lose to {@code 2130706433}, {@code 0x7f.1}, {@code [::ffff:127.0.0.1]}
 * or any DNS name the attacker points at 127.0.0.1.
 */
final class SsrfGuard {

    private static final Set<String> SCHEMES = Set.of("http", "https");
    private static final Set<Integer> PORTS = Set.of(-1, 80, 443);

    private SsrfGuard() {
    }

    /** Returns the parsed URI, or throws 400 if it must not be fetched. */
    static URI check(String url) {
        URI uri;
        try {
            uri = URI.create(url.strip());
        } catch (IllegalArgumentException e) {
            throw reject("malformed url");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!SCHEMES.contains(scheme)) {
            throw reject("only http/https");
        }
        if (uri.getRawUserInfo() != null) {
            throw reject("userinfo not allowed"); // http://trusted.com@evil.com/ confuses humans and parsers
        }
        if (!PORTS.contains(uri.getPort())) {
            throw reject("only ports 80/443"); // otherwise the preview is a port scanner for the intranet
        }
        if (uri.getHost() == null) {
            throw reject("missing host");
        }
        try {
            for (InetAddress address : InetAddress.getAllByName(uri.getHost())) {
                if (isInternal(address)) {
                    throw reject("internal address " + address.getHostAddress());
                }
            }
        } catch (UnknownHostException e) {
            throw reject("unknown host");
        }
        return uri;
    }

    static boolean isInternal(InetAddress a) {
        if (a.isAnyLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress()   // 0.0.0.0, 127/8, 169.254/16 (cloud metadata)
                || a.isSiteLocalAddress() || a.isMulticastAddress()) {                  // 10/8, 172.16/12, 192.168/16
            return true;
        }
        byte[] b = a.getAddress();
        if (a instanceof Inet4Address) {
            int first = b[0] & 0xff, second = b[1] & 0xff;
            return first == 0                                     // 0.0.0.0/8 "this network"
                    || (first == 100 && (second & 0xc0) == 64)    // 100.64/10 carrier-grade NAT, also used by some clouds
                    || (first == 198 && (second & 0xfe) == 18)    // 198.18/15 benchmarking
                    || first >= 240;                              // 240/4 reserved + 255.255.255.255
        }
        if (a instanceof Inet6Address) {
            return (b[0] & 0xfe) == 0xfc;                         // fc00::/7 unique local
        }
        return true;
    }

    private static ResponseStatusException reject(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "url rejected: " + reason);
    }
}
