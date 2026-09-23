package com.aqin.mynotes.lab.l05ssrf;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;

/**
 * Lab 05 - SSRF (VULNERABLE, do not copy).
 * <p>
 * Feature: paste an image URL into a note and the server fetches it to show a preview.
 */
@RestController
public class VulnPreviewController {

    @GetMapping("/vuln/l05/preview")
    public String preview(@RequestParam String url) throws IOException {
        // BUG 1: any scheme URL supports is allowed - file:, jar:, ftp: ...
        // BUG 2: any host, including 127.0.0.1, the intranet and 169.254.169.254
        // BUG 3: redirects are followed, so even a host check here could be bypassed
        // BUG 4: the fetched body is echoed back, turning a blind request into a data leak
        try (InputStream in = URI.create(url).toURL().openStream()) {
            return new String(in.readNBytes(64 * 1024), StandardCharsets.UTF_8);
        }
    }
}
