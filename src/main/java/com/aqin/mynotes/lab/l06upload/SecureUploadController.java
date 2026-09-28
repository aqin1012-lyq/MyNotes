package com.aqin.mynotes.lab.l06upload;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Lab 06 - file upload & path traversal (FIXED).
 */
@RestController
public class SecureUploadController {

    private static final long MAX_BYTES = 5 * 1024 * 1024;
    private static final int MAX_ENTRIES = 100;
    private static final long MAX_UNZIPPED = 20 * 1024 * 1024;

    // Stored outside any web-served directory; files are only handed back through the download endpoint.
    private final Path dir = Paths.get(System.getProperty("java.io.tmpdir"), "mynotes-secure-uploads");

    public record Stored(String id, String ext, long bytes) {
    }

    @PostMapping("/secure/l06/upload")
    public Stored upload(@RequestParam MultipartFile file) throws IOException {
        if (file.isEmpty() || file.getSize() > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "empty or too large");
        }
        Files.createDirectories(dir);
        // Peek at the real first bytes, then validate extension + magic together.
        byte[] head;
        try (InputStream in = file.getInputStream()) {
            head = in.readNBytes(8);
        }
        String ext = UploadGuard.checkType(file.getOriginalFilename(), head);
        // Our own random name: the client's filename never touches the file system, so "../" is moot.
        String id = UUID.randomUUID() + "." + ext;
        try (InputStream in = file.getInputStream()) {
            Files.copy(in, dir.resolve(id), StandardCopyOption.REPLACE_EXISTING);
        }
        return new Stored(id, ext, file.getSize());
    }

    @GetMapping("/secure/l06/files")
    public ResponseEntity<byte[]> download(@RequestParam String name) throws IOException {
        Path target = UploadGuard.resolveInside(dir, name); // normalize + startsWith beats ../
        if (!Files.isRegularFile(target)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                // download, never render: an .html/.svg served inline could run script in our origin
                .header("Content-Disposition", "attachment")
                .header("X-Content-Type-Options", "nosniff")
                .body(Files.readAllBytes(target));
    }

    @PostMapping("/secure/l06/unzip")
    public java.util.List<String> unzip(@RequestParam MultipartFile file) throws IOException {
        Path out = Files.createTempDirectory("mynotes-unzip");
        var names = new java.util.ArrayList<String>();
        long total = 0;
        int count = 0;
        try (ZipInputStream zip = new ZipInputStream(file.getInputStream())) {
            for (ZipEntry e; (e = zip.getNextEntry()) != null; ) {
                if (++count > MAX_ENTRIES) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "too many entries");
                }
                if (e.isDirectory()) {
                    continue;
                }
                // Zip Slip: an entry named "../../x" would otherwise write outside out/.
                Path target = UploadGuard.resolveInside(out, e.getName());
                Files.createDirectories(target.getParent());
                long written = Files.copy(zip, target, StandardCopyOption.REPLACE_EXISTING);
                total += written;
                if (total > MAX_UNZIPPED) { // zip bomb guard
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unzipped size too large");
                }
                names.add(e.getName());
            }
        }
        return names;
    }
}
