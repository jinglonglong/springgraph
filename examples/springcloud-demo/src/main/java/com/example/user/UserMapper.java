package com.example.user;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import java.util.List;

@Mapper
public interface UserMapper {

  @Select("SELECT id, name, email FROM users WHERE id = #{id}")
  UserEntity selectById(@Param("id") Long id);

  List<UserEntity> findAll();

  int insertUser(UserEntity user);

  int updateUser(UserEntity user);
}
