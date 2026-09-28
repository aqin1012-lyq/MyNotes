package com.aqin.mynotes.lab.l06upload;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Lab 06 - decides which uploads are allowed and resolves download paths safely.
 * <p>
 * Two independent user inputs are dangerous here: the file's <em>name</em> (path traversal on both
 * upload and download) and its <em>content</em> (a disguised executable). Handle each explicitly.
 */
final class UploadGuard {

    // Allowlist, not blocklist: a blocklist always forgets an extension (.phtml, .jspx, .svg ...).
    static final Set<String> ALLOWED_EXT = Set.of("png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md");

    // First bytes ("magic number") must match the claimed kind, so a .png can't actually be a script.
    private static final Map<String, byte[]> MAGIC = Map.of(
            "png", new byte[]{(byte) 0x89, 'P', 'N', 'G'},
            "jpg", new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF},
            "jpeg", new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF},
            "gif", new byte[]{'G', 'I', 'F', '8'},
            "pdf", new byte[]{'%', 'P', 'D', 'F'});

    private UploadGuard() {
    }

    static String extension(String filename) {
        if (filename == null) {
            return "";
        }
        // strip any path the client tacked on ("../../x.png", "C:\evil.png") before looking at the dot
        String base = filename.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1);
        int dot = base.lastIndexOf('.');
        return dot < 0 ? "" : base.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    /** Validates the extension and the magic bytes; returns the normalized extension or throws 400. */
    static String checkType(String filename, byte[] head) {
        String ext = extension(filename);
        if (!ALLOWED_EXT.contains(ext)) {
            throw reject("extension not allowed: " + ext);
        }
        byte[] magic = MAGIC.get(ext);
        if (magic != null && !startsWith(head, magic)) {
            throw reject("content does not match ." + ext); // e.g. a script renamed to .png
        }
        return ext;
    }

    /**
     * Resolves {@code name} under {@code base} and guarantees the result stays inside it.
     * The normalize()+startsWith() pair is what defeats {@code ../} — string checks on the name lose.
     */
    static Path resolveInside(Path base, String name) {
        Path root = base.toAbsolutePath().normalize();
        Path target = root.resolve(name).normalize();
        if (!target.startsWith(root)) {
            throw reject("path escapes the upload directory");
        }
        return target;
    }

    private static boolean startsWith(byte[] data, byte[] prefix) {
        return data.length >= prefix.length && Arrays.equals(data, 0, prefix.length, prefix, 0, prefix.length);
    }

    static byte[] head(Path file) {
        try (var in = Files.newInputStream(file)) {
            return in.readNBytes(8);
        } catch (IOException e) {
            return new byte[0];
        }
    }

    private static ResponseStatusException reject(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "upload rejected: " + reason);
    }
}
