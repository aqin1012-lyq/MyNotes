package com.aqin.mynotes.lab.l06upload;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class UploadTests {

    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10};

    @Autowired
    MockMvc mvc;

    // ---- attacks: /vuln lets them through, /secure blocks them ----

    @Test
    void pathTraversalOnDownloadLeaksAnyFileOnVuln() throws Exception {
        Path secret = Files.createTempFile("mynotes-secret", ".txt");
        Files.writeString(secret, "db.password=hunter2");
        // climb from the upload dir back to the temp dir and read the secret by relative path
        String escape = "../" + secret.getFileName();
        // a real ../ needs its parent dir to exist; one legit upload creates it
        mvc.perform(multipart("/vuln/l06/upload").file(new MockMultipartFile("file", "seed.txt", "text/plain", "x".getBytes())))
                .andExpect(status().isOk());

        mvc.perform(get("/vuln/l06/files").param("name", escape))
                .andExpect(status().isOk())
                .andExpect(result -> assertThat(result.getResponse().getContentAsString()).contains("hunter2"));
        mvc.perform(get("/secure/l06/files").param("name", escape))
                .andExpect(status().isBadRequest());
    }

    @Test
    void traversalOnUploadEscapesFolderOnVuln() throws Exception {
        String marker = "shell-" + System.nanoTime();
        Path escaped = Paths.get(System.getProperty("java.io.tmpdir"), marker + ".txt");
        Files.deleteIfExists(escaped);
        var evil = new MockMultipartFile("file", "../" + marker + ".txt", "text/plain", "pwned".getBytes());

        mvc.perform(multipart("/vuln/l06/upload").file(evil)).andExpect(status().isOk());
        assertThat(Files.exists(escaped)).as("vuln upload wrote outside its folder").isTrue();
        Files.deleteIfExists(escaped);

        // secure gives the file its own random name, so the traversal in the client name is ignored:
        // the upload succeeds but nothing escapes the folder
        mvc.perform(multipart("/secure/l06/upload").file(evil)).andExpect(status().isOk());
        assertThat(Files.exists(escaped)).as("secure upload must not honour the client path").isFalse();
    }

    @Test
    void scriptDisguisedAsImageIsRejectedBySecure() throws Exception {
        var jspAsPng = new MockMultipartFile("file", "avatar.png", "image/png",
                "<% Runtime.getRuntime().exec(\"id\"); %>".getBytes(StandardCharsets.UTF_8));
        // vuln keeps whatever bytes under whatever name
        mvc.perform(multipart("/vuln/l06/upload").file(jspAsPng)).andExpect(status().isOk());
        // secure sees the magic bytes don't match .png
        mvc.perform(multipart("/secure/l06/upload").file(jspAsPng)).andExpect(status().isBadRequest());
    }

    @Test
    void executableExtensionIsRejectedBySecure() throws Exception {
        var jsp = new MockMultipartFile("file", "shell.jsp", "application/octet-stream", "code".getBytes());
        mvc.perform(multipart("/secure/l06/upload").file(jsp)).andExpect(status().isBadRequest());
    }

    // ---- the secure happy path and the guard itself ----

    @Test
    void validImageRoundTripsThroughSecure() throws Exception {
        var png = new MockMultipartFile("file", "cat.PNG", "image/png", PNG);
        String body = mvc.perform(multipart("/secure/l06/upload").file(png))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ext").value("png"))
                .andReturn().getResponse().getContentAsString();
        String id = body.replaceAll(".*\"id\":\"([^\"]+)\".*", "$1");
        assertThat(id).endsWith(".png").doesNotContain("cat");
        mvc.perform(get("/secure/l06/files").param("name", id)).andExpect(status().isOk());
    }

    @Test
    void zipSlipEntryIsContainedBySecureUnzip() throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(buf)) {
            zip.putNextEntry(new ZipEntry("notes/ok.txt"));
            zip.write("fine".getBytes());
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry("../../../../tmp/mynotes-zipslip.txt")); // the attack
            zip.write("escaped".getBytes());
            zip.closeEntry();
        }
        Path slip = Paths.get("/tmp/mynotes-zipslip.txt");
        Files.deleteIfExists(slip);
        var zipFile = new MockMultipartFile("file", "a.zip", "application/zip", buf.toByteArray());

        mvc.perform(multipart("/secure/l06/unzip").file(zipFile)).andExpect(status().isBadRequest());
        assertThat(Files.exists(slip)).as("secure unzip must not write outside the target dir").isFalse();
    }

    @Test
    void guardResolvesInsideAndRejectsEscapes() {
        Path base = Paths.get(System.getProperty("java.io.tmpdir"), "mynotes-guard-test");
        assertThat(UploadGuard.resolveInside(base, "a/b.png")).startsWithRaw(base.toAbsolutePath().normalize());
        for (String bad : new String[]{"../x", "../../etc/passwd", "a/../../x", "/etc/passwd"}) {
            try {
                UploadGuard.resolveInside(base, bad);
                assertThat(false).as("should reject " + bad).isTrue();
            } catch (org.springframework.web.server.ResponseStatusException expected) {
                // ok
            }
        }
    }
}
