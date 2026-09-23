package com.aqin.mynotes.lab.l05ssrf;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Map;

/**
 * Lab 05 - the SSRF target: stands in for a cloud metadata service (169.254.169.254).
 * <p>
 * Like the real one, it trusts anything that can reach it and never sees the outside world directly,
 * so the only way in from the Internet is to make the server itself send the request.
 */
@RestController
public class FakeMetadataController {

    @GetMapping("/internal/l05/latest/meta-data/iam/security-credentials/mynotes-role")
    public Map<String, String> credentials(HttpServletRequest request) throws UnknownHostException {
        if (!InetAddress.getByName(request.getRemoteAddr()).isLoopbackAddress()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return Map.of(
                "AccessKeyId", "AKIAFAKEFORLAB05",
                "SecretAccessKey", "lab05/fake/secret/do-not-use",
                "Token", "fake-session-token");
    }
}
