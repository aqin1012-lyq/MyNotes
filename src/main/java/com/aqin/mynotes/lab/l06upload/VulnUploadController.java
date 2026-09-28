package com.aqin.mynotes.lab.l06upload;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Lab 06 - file upload & path traversal (VULNERABLE, do not copy).
 * <p>
 * Feature: attach a file to a note, then download it back by name.
 */
@RestController
public class VulnUploadController {

    // Uploads land here; the download endpoint reads from the same place.
    private final Path dir = Paths.get(System.getProperty("java.io.tmpdir"), "mynotes-vuln-uploads");

    @PostMapping("/vuln/l06/upload")
    public String upload(@RequestParam MultipartFile file) throws IOException {
        Files.createDirectories(dir);
        // BUG 1: the client-supplied filename is trusted as-is, so "../../x" escapes the folder
        // BUG 2: no extension / content check, so a .jsp / .sh / .html shell can be stored
        Path target = dir.resolve(file.getOriginalFilename());
        Files.createDirectories(target.getParent());
        file.transferTo(target);
        return "saved: " + target;
    }

    @GetMapping("/vuln/l06/files")
    public ResponseEntity<byte[]> download(@RequestParam String name) throws IOException {
        // BUG 3: name is concatenated to the base dir, so "../../../../etc/passwd" reads any file
        Path target = dir.resolve(name);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(Files.readAllBytes(target));
    }
}
