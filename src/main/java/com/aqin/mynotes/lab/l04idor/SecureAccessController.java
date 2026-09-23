package com.aqin.mynotes.lab.l04idor;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * Lab 04 - Broken access control (FIXED) —— 练习：你来实现。
 * <p>
 * 要求见 docs/labs/04-access-control.md，实现后删掉 AccessControlTests 里的 @Disabled。
 */
@RestController
public class SecureAccessController {

    @GetMapping("/secure/l04/notes/{id}")
    public ResponseEntity<?> get(@RequestHeader("X-User-Id") long userId, @PathVariable long id) {
        // TODO: 只能读自己的笔记
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).build();
    }

    @GetMapping("/secure/l04/admin/users")
    public ResponseEntity<?> listUsers(@RequestHeader("X-User-Id") long userId) {
        // TODO: 只有 ADMIN 能访问，且返回结果不能包含密码
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).build();
    }
}
