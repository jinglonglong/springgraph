package com.example.order;

public record OrderDTO(Long userId, Integer total) {
  public static OrderDTO empty(Long userId) {
    return new OrderDTO(userId, 0);
  }
}
