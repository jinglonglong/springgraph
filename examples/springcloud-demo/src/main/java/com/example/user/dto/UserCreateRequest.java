package com.example.user.dto;

public record UserCreateRequest(String name, String email) {
  public UserDTO toDto() {
    return new UserDTO(null, name, email);
  }
}
