package com.example.user.dto;

public record UserDTO(Long id, String name, String email) {
  public static UserDTO sample() {
    return new UserDTO(1L, "demo", "demo@example.com");
  }
}
