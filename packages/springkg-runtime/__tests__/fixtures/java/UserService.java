package com.example;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class UserService {

    @Value("${spring.datasource.url}")
    private String dbUrl;

    @Value("${spring.redis.host}")
    private String redisHost;

    public String getDbUrl() {
        return dbUrl;
    }
}
