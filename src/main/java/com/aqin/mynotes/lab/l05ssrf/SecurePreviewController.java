package com.aqin.mynotes.lab.l05ssrf;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Lab 05 - SSRF (FIXED).
 * <p>
 * Remaining gap, on purpose: {@link SsrfGuard} resolves the host, then HttpClient resolves it again.
 * A DNS rebinding server can answer "public IP" the first time and "127.0.0.1" the second.
 * See docs/labs/05-ssrf.md for how to close it (egress proxy / network policy).
 */
@RestController
public class SecurePreviewController {

    public record Preview(String url, String contentType, int bytes) {
    }

    private static final int MAX_BYTES = 5 * 1024 * 1024;

    private final HttpClient http = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NEVER) // a 302 to 169.254.169.254 would skip the guard
            .connectTimeout(Duration.ofSeconds(3))
            .build();

    @GetMapping("/secure/l05/preview")
    public Preview preview(@RequestParam String url) throws IOException, InterruptedException {
        URI uri = SsrfGuard.check(url);
        HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(5)).GET().build();
        HttpResponse<InputStream> response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
        try (InputStream body = response.body()) {
            if (response.statusCode() != 200) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "upstream status " + response.statusCode());
            }
            String type = response.headers().firstValue("Content-Type").orElse("");
            if (!type.startsWith("image/")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "not an image");
            }
            byte[] bytes = body.readNBytes(MAX_BYTES + 1);
            if (bytes.length > MAX_BYTES) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "image too large");
            }
            // Only metadata goes back to the caller, never the fetched bytes as text.
            return new Preview(uri.toString(), type, bytes.length);
        }
    }
}
