package com.example.order;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

@FeignClient(name = "order-service", path = "/orders")
public interface OrderClient {

    @GetMapping("/{id}")
    String getOrderById(@PathVariable("id") Long id);

    @PostMapping
    String createOrder(@RequestBody Object order);
}
