package com.example.user;

import com.example.user.dto.UserCreateRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service
public class UserService {
  private final UserMapper userMapper; public UserService(UserMapper userMapper) { this.userMapper = userMapper; }
  public List<UserEntity> findAll() { return userMapper.findAll(); }
  @Transactional public UserEntity create(UserCreateRequest request) { UserEntity user = new UserEntity(request.name(), request.email()); userMapper.insertUser(user); return user; }
}
