# Build standalone do núcleo HoopsSimCore + testes (fora da Unreal).
#   cmake -S Plugins/HoopsSim/Tests -B build/tests && cmake --build build/tests && ./build/tests/hoops_tests
cmake_minimum_required(VERSION 3.20)
project(HoopsSimTests CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CORE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../Source/HoopsSimCore)

# Só os arquivos de C++ puro (HoopsSimCoreModule.cpp é exclusivo da Unreal).
add_library(hoops_core STATIC
	${CORE_DIR}/Private/HoopsBallSim.cpp
	${CORE_DIR}/Private/HoopsShotModel.cpp
	${CORE_DIR}/Private/HoopsShotSolver.cpp
	${CORE_DIR}/Private/HoopsProStick.cpp
	${CORE_DIR}/Private/HoopsDribbleMoves.cpp
)
target_include_directories(hoops_core PUBLIC ${CORE_DIR}/Public)
target_compile_definitions(hoops_core PUBLIC HOOPSSIMCORE_API=)

# Mesmas restrições da Unreal: sem exceções/RTTI no núcleo; avisos de sombra tratados como erro.
if (MSVC)
	target_compile_options(hoops_core PRIVATE /W4 /WX /we4456 /we4457 /we4458 /we4459)
else()
	target_compile_options(hoops_core PRIVATE -Wall -Wextra -Wshadow -Wconversion -Werror -fno-exceptions -fno-rtti)
endif()

add_executable(hoops_tests HoopsSimTests.cpp)
target_link_libraries(hoops_tests PRIVATE hoops_core)
