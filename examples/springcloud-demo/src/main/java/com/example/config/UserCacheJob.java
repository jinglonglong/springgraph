package com.example.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class UserCacheJob {
  @Value("${spring.application.name}") private String appName;
  @Scheduled(fixedDelay = 60000)
  public void warmup() { System.out.println(appName + ":warmup"); }
}
