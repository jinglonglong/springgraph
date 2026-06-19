package com.example.user;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    private final UserMapper userMapper;

    public UserService(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    public String findById(Long id) {
        return userMapper.selectById(id);
    }

    public String findAll() {
        return userMapper.selectAll();
    }

    @Transactional
    public String insert(UserEntity user) {
        return userMapper.insertUser(user);
    }

    @Transactional
    public String update(UserEntity user) {
        return userMapper.updateUser(user);
    }
}
