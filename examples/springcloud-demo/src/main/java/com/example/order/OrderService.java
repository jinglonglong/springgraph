package com.example.order;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.Map;

@Service
public class OrderService {
  private final OrderMapper orderMapper;
  public OrderService(OrderMapper orderMapper) { this.orderMapper = orderMapper; }

  public Map<String, Object> getOrderSummary(Long userId) {
    return Map.of("userId", userId, "total", orderMapper.countByUser(userId));
  }

  @Transactional
  public void cleanupExpired() { orderMapper.deleteExpired(); }
}
