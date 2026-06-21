package com.example.user;

import com.example.user.dto.UserCreateRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;

@RestController
public class UserController {
  private final UserService userService; public UserController(UserService userService) { this.userService = userService; }
  @GetMapping("/api/users") public List<UserEntity> list() { return userService.findAll(); }
  @PostMapping("/api/users") public UserEntity create(@RequestBody UserCreateRequest request) { return userService.create(request); }
}
