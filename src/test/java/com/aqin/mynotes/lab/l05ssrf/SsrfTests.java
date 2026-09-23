package com.aqin.mynotes.lab.l05ssrf;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

import java.net.InetAddress;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class SsrfTests {

    private static final String METADATA_PATH = "/internal/l05/latest/meta-data/iam/security-credentials/mynotes-role";
    private static final String SECRET = "lab05/fake/secret/do-not-use";

    @Value("${local.server.port}")
    int port;

    @Autowired
    MockMvc mvc;

    // A desktop proxy (macOS system proxy -> http.proxyHost) would carry the "attack" requests away from
    // this machine: 127.0.0.1 is usually on its bypass list, 2130706433 is not. Keep the tests self-contained.
    private static final String[] PROXY_PROPS = {"http.proxyHost", "http.proxyPort", "https.proxyHost", "https.proxyPort"};
    private static final String[] savedProxy = new String[PROXY_PROPS.length];

    @BeforeAll
    static void disableProxy() {
        for (int i = 0; i < PROXY_PROPS.length; i++) {
            savedProxy[i] = System.clearProperty(PROXY_PROPS[i]);
        }
    }

    @AfterAll
    static void restoreProxy() {
        for (int i = 0; i < PROXY_PROPS.length; i++) {
            if (savedProxy[i] != null) {
                System.setProperty(PROXY_PROPS[i], savedProxy[i]);
            }
        }
    }

    // ---- attacks: /vuln leaks, /secure refuses ----

    @Test
    void metadataCredentialsLeakThroughVulnPreview() throws Exception {
        String url = "http://127.0.0.1:" + port + METADATA_PATH;
        mvc.perform(get("/vuln/l05/preview").param("url", url))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString(SECRET)));
        mvc.perform(get("/secure/l05/preview").param("url", url))
                .andExpect(status().isBadRequest());
    }

    @Test
    void decimalIpBypassesNaiveHostBlocklist() throws Exception {
        // 2130706433 == 127.0.0.1; a check like host.equals("127.0.0.1") would let this through
        String url = "http://2130706433:" + port + METADATA_PATH;
        mvc.perform(get("/vuln/l05/preview").param("url", url))
                .andExpect(content().string(containsString(SECRET)));
        mvc.perform(get("/secure/l05/preview").param("url", url))
                .andExpect(status().isBadRequest());
    }

    @Test
    void fileSchemeReadsLocalFilesOnVuln(@TempDir Path dir) throws Exception {
        Path secret = Files.writeString(dir.resolve("application-prod.properties"), "db.password=hunter2");
        String url = secret.toUri().toString();
        mvc.perform(get("/vuln/l05/preview").param("url", url))
                .andExpect(content().string("db.password=hunter2"));
        mvc.perform(get("/secure/l05/preview").param("url", url))
                .andExpect(status().isBadRequest());
    }

    // ---- the guard itself ----

    @Test
    void guardRejectsInternalAndOddUrls() {
        String[] rejected = {
                "http://169.254.169.254/latest/meta-data/",   // cloud metadata
                "http://localhost/",
                "http://[::1]/",
                "http://[::ffff:127.0.0.1]/",                 // IPv4-mapped IPv6
                "http://0.0.0.0/",
                "http://10.0.0.5/", "http://172.16.1.1/", "http://192.168.1.1/",
                "http://100.100.100.200/",                    // CGNAT range, e.g. Alibaba Cloud metadata
                "http://[fd00::1]/",
                "http://93.184.215.14:22/",                   // public, but not 80/443
                "http://good.example@127.0.0.1/",             // userinfo
                "ftp://93.184.215.14/", "gopher://93.184.215.14/", "jar:http://93.184.215.14/x.jar!/",
                "not a url",
        };
        for (String url : rejected) {
            assertThatThrownBy(() -> SsrfGuard.check(url)).as(url).isInstanceOf(ResponseStatusException.class);
        }
    }

    @Test
    void guardAllowsPublicHttpUrls() throws Exception {
        assertThat(SsrfGuard.check("https://93.184.215.14/cat.png")).hasHost("93.184.215.14");
        assertThat(SsrfGuard.check("http://93.184.215.14:80/cat.png")).hasPort(80);
        assertThat(SsrfGuard.isInternal(InetAddress.getByName("8.8.8.8"))).isFalse();
        assertThat(SsrfGuard.isInternal(InetAddress.getByName("100.128.0.1"))).isFalse(); // just outside 100.64/10
    }
}
