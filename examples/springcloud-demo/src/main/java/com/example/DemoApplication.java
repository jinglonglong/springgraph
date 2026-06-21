package com.example;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.scheduling.annotation.EnableScheduling;

@EnableScheduling @EnableFeignClients @MapperScan("com.example.user") @SpringBootApplication
public class DemoApplication { public static void main(String[] args) { SpringApplication.run(DemoApplication.class, args); } }
