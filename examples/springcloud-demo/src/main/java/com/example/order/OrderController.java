package com.example.order;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
  private final OrderService orderService;
  public OrderController(OrderService orderService) { this.orderService = orderService; }

  @GetMapping("/summary")
  public Map<String, Object> summary(Long userId) {
    return orderService.getOrderSummary(userId);
  }

  @Scheduled(fixedRate = 30000)
  public void cleanup() { orderService.cleanupExpired(); }
}
