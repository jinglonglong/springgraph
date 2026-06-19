package com.example.user;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/{id}")
    public String getUserById(@PathVariable Long id) {
        return userService.findById(id);
    }

    @GetMapping
    public String listUsers() {
        return userService.findAll();
    }

    @PostMapping
    public String createUser(@RequestBody UserEntity user) {
        return userService.insert(user);
    }
}
